using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// Shared resolution logic for refining a raw GitHub <c>failure</c>/<c>error</c> status
/// to the correct contract status. Used by both the normal poll and backfill paths.
/// </summary>
public sealed class GithubStatusResolver(
    GithubClient github,
    WorkflowGraphCache graphCache,
    ILogger<GithubStatusResolver> logger)
{
    private const string ReviewStateRejected = "rejected";
    private const string ConclusionCancelled = "cancelled";

    /// <summary>
    /// Groups the identity parameters for a single GitHub deployment.
    /// </summary>
    internal readonly record struct GithubDeploymentRef(
        string Owner,
        string RepoName,
        long DeploymentId,
        long? RunId);

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
    internal async Task<string> ResolveFailureStatusAsync(
        GithubDeploymentRef deployment,
        CancellationToken ct)
    {
        if (await HasRejectedReviewAsync(deployment, ct))
            return DeploymentStatus.Rejected;

        if (await IsRunCancelledAsync(deployment, ct))
            return DeploymentStatus.Cancelled;

        return DeploymentStatus.Failure;
    }

    // ── private predicates ────────────────────────────────────────────────────

    private async Task<bool> HasRejectedReviewAsync(
        GithubDeploymentRef deployment,
        CancellationToken ct)
    {
        try
        {
            await foreach (var review in github.GetPagedAsync<GhDeploymentReview>(
                $"/repos/{deployment.Owner}/{deployment.RepoName}/deployments/{deployment.DeploymentId}/reviews", ct))
            {
                if (review.State.Equals(ReviewStateRejected, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "[{Owner}/{Repo}] deployment reviews fetch failed for deployment {DeploymentId}",
                deployment.Owner, deployment.RepoName, deployment.DeploymentId);
        }

        return false;
    }

    private async Task<bool> IsRunCancelledAsync(
        GithubDeploymentRef deployment,
        CancellationToken ct)
    {
        if (!deployment.RunId.HasValue)
            return false;

        try
        {
            var run = await graphCache.GetOrFetchRunAsync(
                deployment.Owner, deployment.RepoName, deployment.RunId.Value, github, ct);
            return run?.Conclusion?.Equals(ConclusionCancelled, StringComparison.OrdinalIgnoreCase) is true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "[{Owner}/{Repo}] run conclusion fetch failed for run {RunId}",
                deployment.Owner, deployment.RepoName, deployment.RunId);
        }

        return false;
    }
}
