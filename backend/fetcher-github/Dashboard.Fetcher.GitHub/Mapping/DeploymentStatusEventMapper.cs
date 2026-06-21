using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Mapping;

/// <summary>
/// Maps a freshly-fetched set of deployment statuses from a poll cycle to ingest events (§5.2).
/// Encapsulates BuildEnvMap, status event enumeration, single-status mapping, version resolution,
/// parent derivation, and failure refinement — decoupled from the GitHub fetch concerns in
/// <see cref="GithubActionsAdapter"/>.
/// </summary>
public sealed class DeploymentStatusEventMapper(
    GithubClient github,
    WorkflowGraphCache graphCache,
    VersionResolver versionResolver,
    WorkflowExcludeFilter workflowExcludeFilter,
    ILogger<DeploymentStatusEventMapper> logger)
{
    /// <summary>
    /// Builds the env→deploymentId map used for parent derivation (§5.6.4).
    /// Includes freshly-fetched, cached-terminal, and etag-304-reused deployments
    /// so that parent edges to finished/unchanged environments remain resolvable.
    /// </summary>
    internal static Dictionary<long, Dictionary<string, string>> BuildEnvMap(
        List<GhDeployment> deployments,
        Dictionary<long, long?> reusedRunIds,
        Dictionary<long, List<GhDeploymentStatus>> allStatuses)
    {
        var envMapEntries = deployments.SelectMany<GhDeployment, (long DeploymentId, string Environment, DateTimeOffset CreatedAt, long? RunId)>(d =>
        {
            if (reusedRunIds.TryGetValue(d.Id, out var reusedRunId))
                return [(d.Id, d.Environment, d.CreatedAt, reusedRunId)];

            return allStatuses.GetValueOrDefault(d.Id, [])
                .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                .Where(r => r.HasValue)
                .Take(1)
                .Select(r => (d.Id, d.Environment, d.CreatedAt, r));
        });

        return ParentDerivation.BuildEnvToDeploymentIdMap(envMapEntries);
    }

    /// <summary>
    /// Maps freshly-fetched deployment statuses created after <paramref name="ctx"/>.Since into
    /// ingest events. Fetches workflow graphs and resolves versions per status.
    /// Skips terminal-cache and ETag-304 deployments (their statuses were not re-fetched).
    /// </summary>
    internal async Task<(List<DeploymentEventIngest> Events, DateTimeOffset MaxSince)> MapStatusEventsAsync(
        RepoFetchContext ctx,
        IReadOnlyDictionary<string, string> serviceMap,
        List<GhDeployment> deployments,
        Dictionary<long, long?> reusedRunIds,
        Dictionary<long, List<GhDeploymentStatus>> allStatuses,
        Dictionary<long, Dictionary<string, string>> envMap,
        CancellationToken ct)
    {
        var events = new List<DeploymentEventIngest>();
        var maxSince = ctx.Since;

        foreach (var deployment in deployments)
        {
            if (reusedRunIds.ContainsKey(deployment.Id))
                continue; // terminal or 304 — statuses not re-fetched, no new events

            var statuses = allStatuses.GetValueOrDefault(deployment.Id, []);

            foreach (var status in statuses)
            {
                var mapped = await MapOneStatusAsync(ctx, serviceMap, deployment, status, envMap, ct);
                if (mapped is null)
                    continue;

                events.Add(mapped.Value.Event);
                if (mapped.Value.At > maxSince)
                    maxSince = mapped.Value.At;
            }
        }

        return (events, maxSince);
    }

    /// <summary>
    /// Maps a single deployment status to an ingest event, or returns null if the status
    /// should be skipped (before the poll window, unmapped state, or no-content).
    /// </summary>
    internal async Task<(DeploymentEventIngest Event, DateTimeOffset At)?> MapOneStatusAsync(
        RepoFetchContext ctx,
        IReadOnlyDictionary<string, string> serviceMap,
        GhDeployment deployment,
        GhDeploymentStatus status,
        Dictionary<long, Dictionary<string, string>> envMap,
        CancellationToken ct)
    {
        if (status.CreatedAt <= ctx.Since)
            return null;

        var contractStatus = StatusMapper.Map(status.State);
        if (contractStatus is null)
            return null;

        var runId = EventMapper.ExtractRunId(status.TargetUrl);

        WorkflowGraph? graph = null;
        if (runId.HasValue)
        {
            try
            {
                graph = await graphCache.GetOrFetchGraphAsync(
                    ctx.Owner, ctx.RepoName, runId.Value, github, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "[{Repo}] workflow graph fetch failed for run {RunId}", ctx.Repo, runId);
            }
        }

        // Apply workflow exclude filter once the workflow name is resolved.
        // When the workflow name is null (graph unavailable), only '*' patterns match — acceptable.
        var workflowName = graph?.WorkflowName ?? string.Empty;
        if (workflowExcludeFilter.IsExcluded(ctx.Owner, ctx.RepoName, workflowName))
            return null;

        // Refine failure → cancelled/rejected by cross-referencing run conclusion + reviews.
        if (StatusMapper.IsFailureStatus(contractStatus))
            contractStatus = await DeploymentMapper.ResolveFailureStatusAsync(
                new DeploymentLookupContext(ctx.Owner, ctx.RepoName, deployment.Id, runId),
                github, graphCache, logger, ct);

        var parentDeployments = DeploymentMapper.DeriveParents(deployment, runId, graph, envMap);

        string? version = null;
        try
        {
            version = await versionResolver.ResolveAsync(
                ctx.Owner, ctx.RepoName, deployment, status, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "[{Repo}] version resolution failed for deployment {Id}", ctx.Repo, deployment.Id);
        }

        var ev = EventMapper.Map(
            deployment, status, ctx.Repo, contractStatus,
            new EventMappingContext(graph?.WorkflowName, version, parentDeployments, serviceMap));

        return (ev, status.CreatedAt);
    }
}
