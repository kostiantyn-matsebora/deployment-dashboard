using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Mapping;

/// <summary>Shared deployment-level mapping helpers used by the adapter and backfill paths.</summary>
internal static class DeploymentMapper
{
    /// <summary>
    /// Resolves the failure sub-status for a deployment by inspecting reviews and the run
    /// conclusion: <see cref="DeploymentStatus.Rejected"/> &gt; <see cref="DeploymentStatus.Cancelled"/> &gt;
    /// <see cref="DeploymentStatus.Failure"/> (§5.3 failure classification).
    /// </summary>
    internal static async Task<string> ResolveFailureStatusAsync(
        DeploymentLookupContext ctx,
        GithubClient github,
        WorkflowGraphCache graphCache,
        ILogger logger,
        CancellationToken ct)
    {
        // Check reviews first — rejection is the most specific signal.
        try
        {
            await foreach (var review in github.GetPagedAsync<GhDeploymentReview>(
                $"/repos/{ctx.Owner}/{ctx.RepoName}/deployments/{ctx.DeploymentId}/reviews", ct))
            {
                if (review.State.Equals("rejected", StringComparison.OrdinalIgnoreCase))
                    return DeploymentStatus.Rejected;
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "[{Owner}/{Repo}] deployment reviews fetch failed for deployment {DeploymentId}",
                ctx.Owner, ctx.RepoName, ctx.DeploymentId);
        }

        // Check run conclusion for cancellation.
        if (ctx.RunId.HasValue)
        {
            try
            {
                var run = await graphCache.GetOrFetchRunAsync(ctx.Owner, ctx.RepoName, ctx.RunId.Value, github, ct);
                if (run?.Conclusion?.Equals("cancelled", StringComparison.OrdinalIgnoreCase) is true)
                    return DeploymentStatus.Cancelled;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "[{Owner}/{Repo}] run conclusion fetch failed for run {RunId}",
                    ctx.Owner, ctx.RepoName, ctx.RunId);
            }
        }

        return DeploymentStatus.Failure;
    }

    /// <summary>
    /// Derives the parent deployment IDs for a given deployment from the workflow graph
    /// and the accumulated env-to-deployment-id map (§5.6.4 cross-env edges).
    /// </summary>
    internal static string[] DeriveParents(
        GhDeployment deployment,
        long? runId,
        WorkflowGraph? graph,
        Dictionary<long, Dictionary<string, string>> envMap)
    {
        if (runId is null || graph is null)
            return [];

        var deployJob = graph.DeploymentJobs.Values
            .FirstOrDefault(j => j.Environment == deployment.Environment);
        if (deployJob is null)
            return [];

        var parentJobIds = ParentDerivation.FindParentDeploymentJobIds(
            deployJob, graph.DeploymentJobs, graph.AllJobs);

        if (!envMap.TryGetValue(runId.Value, out var resolvedEnvMap))
            return [];

        return parentJobIds
            .Select(id => graph.DeploymentJobs.TryGetValue(id, out var j) ? j.Environment : null)
            .Where(env => env is not null)
            .Select(env => resolvedEnvMap.TryGetValue(env!, out var ghId) ? ghId : null)
            .Where(id => id is not null)
            .Select(id => id!)
            .Distinct()
            .ToArray();
    }
}

/// <summary>Cohesive identity parameters for a single deployment lookup.</summary>
internal readonly record struct DeploymentLookupContext(
    string Owner,
    string RepoName,
    long DeploymentId,
    long? RunId);
