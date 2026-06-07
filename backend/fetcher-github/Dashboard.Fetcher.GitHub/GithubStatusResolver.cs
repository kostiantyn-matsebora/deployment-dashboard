using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// Shared resolution logic for refining a raw GitHub <c>failure</c>/<c>error</c> status
/// to the correct contract status. Used by both the normal poll and backfill paths.
/// </summary>
internal static class GithubStatusResolver
{
    /// <summary>
    /// Refines a raw GitHub <c>failure</c>/<c>error</c> deployment status to the correct
    /// contract status:
    /// <list type="bullet">
    ///   <item><c>rejected</c> — at least one deployment review has <c>state = "rejected"</c>
    ///         (reviewer explicitly denied the environment gate).</item>
    ///   <item><c>cancelled</c> — the associated workflow run's <c>conclusion</c> is
    ///         <c>"cancelled"</c> (run was cancelled before or during execution).</item>
    ///   <item><c>failure</c> — neither of the above; the deployment ran and failed.</item>
    /// </list>
    /// Reviews are checked first because a rejected gate also produces a cancelled-like
    /// run conclusion on some GitHub configurations; rejected is the more specific signal.
    /// </summary>
    internal static async Task<string> ResolveFailureStatusAsync(
        string owner,
        string repoName,
        long deploymentId,
        long? runId,
        GithubClient github,
        WorkflowGraphCache graphCache,
        ILogger logger,
        CancellationToken ct)
    {
        // Check reviews first — rejection is the most specific signal.
        try
        {
            await foreach (var review in github.GetPagedAsync<GhDeploymentReview>(
                $"/repos/{owner}/{repoName}/deployments/{deploymentId}/reviews", ct))
            {
                if (review.State.Equals("rejected", StringComparison.OrdinalIgnoreCase))
                    return DeploymentStatus.Rejected;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "[{Owner}/{Repo}] deployment reviews fetch failed for deployment {DeploymentId}",
                owner, repoName, deploymentId);
        }

        // Check run conclusion for cancellation.
        if (runId.HasValue)
        {
            try
            {
                var run = await graphCache.GetOrFetchRunAsync(owner, repoName, runId.Value, github, ct);
                if (run?.Conclusion?.Equals("cancelled", StringComparison.OrdinalIgnoreCase) is true)
                    return DeploymentStatus.Cancelled;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "[{Owner}/{Repo}] run conclusion fetch failed for run {RunId}",
                    owner, repoName, runId);
            }
        }

        return DeploymentStatus.Failure;
    }
}
