using System.Diagnostics.CodeAnalysis;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Backfill;

/// <summary>
/// Env-scan, event-building, and utility methods extracted from <see cref="BackfillRunner"/>
/// to reduce its class coupling (§S1200). Owns Pass 1 (collect chosen deployments), Pass 2
/// (build ingest events), slot trimming, env-map merging, and shared per-deployment helpers.
/// </summary>
// S1200: This class is itself the coupling-reduction extraction from BackfillRunner (§S1200).
// The WorkflowExcludeFilter dependency added by #348 is required for workflow-scope filtering during
// backfill scans and cannot be removed.  Splitting further would fragment cohesive scan logic
// without a genuine coupling benefit.
[SuppressMessage("SonarAnalyzer", "S1200", Justification = "Class is a coupling-reduction extraction from BackfillRunner; WorkflowExcludeFilter dependency is required for #348 workflow-scope filter. Further splitting would fragment cohesive scan logic without genuine coupling benefit.")]
public sealed class BackfillEventBuilder(
    GithubClient github,
    WorkflowGraphCache graphCache,
    VersionResolver versionResolver,
    WorkflowExcludeFilter workflowExcludeFilter,
    ILogger<BackfillEventBuilder> logger)
{
    // Consecutive deployments with no new data before scanning stops for an environment (F13).
    // "No data" means the service is unknown or has zero mapped statuses; a slot that is already
    // full (eventsSoFar >= depth) is skipped silently so quieter services sharing the same
    // environment can still reach depth — it does NOT count as no-progress.
    private const int StallWindow = 20;

    // ── per-env scan ──────────────────────────────────────────────────────────

    /// <summary>
    /// Scans one environment and returns the trimmed events plus the raw deployment
    /// collection for the caller to merge into the repo env-map.
    /// </summary>
    internal async Task<(List<DeploymentEventIngest> Events,
        List<(long Id, string Env, DateTimeOffset CreatedAt, long? RunId)> Deployments)>
        BackfillEnvAsync(
            BackfillEnvContext ctx,
            IReadOnlyDictionary<string, string> pathToService,
            IReadOnlySet<string> allServiceNames,
            IReadOnlyDictionary<string, string> serviceMap,
            Dictionary<long, Dictionary<string, string>> repoEnvMap,
            int depth,
            CancellationToken ct)
    {
        var depth1 = depth > 0 ? depth : 1;

        // Pass 1: collect chosen deployments for this env.
        var chosen = await CollectChosenDeploymentsAsync(
            ctx, pathToService, allServiceNames, serviceMap, depth1, ct);

        // Collect the raw deployment tuples for the caller to merge into the repo map.
        var deploymentTuples = chosen
            .Select(c => (c.Deployment.Id, c.Deployment.Environment, c.Deployment.CreatedAt, c.RunId))
            .ToList();

        // Build the env map using all known repo deployments so far PLUS this env's new ones.
        // This ensures parent edges from this env back to a prior env in the same run are resolved.
        var combinedMap = new Dictionary<long, Dictionary<string, string>>(repoEnvMap);
        MergeIntoMap(combinedMap, deploymentTuples);

        // Pass 2: build events and trim by slot depth.
        var candidateEvents = await BuildEnvEventsAsync(
            ctx.Owner, ctx.RepoName, ctx.Repo, chosen, serviceMap, combinedMap, ct);

        var events = TrimEventsBySlotDepth(candidateEvents, depth1);

        return (events, deploymentTuples);
    }

    /// <summary>
    /// Pass 1: pages through GitHub deployments for one environment and returns
    /// the chosen subset — up to <paramref name="depth"/> mapped statuses per service slot,
    /// stopping early when the stall window is exhausted or the cutoff is reached.
    /// Each slot is filled independently: a deployment for an already-full service is skipped
    /// (the scan keeps paging so quieter services in the same env can still reach depth),
    /// and is never treated as no-progress. <c>consecutiveNoProgress</c> increments only when
    /// a service is unknown or has zero mapped statuses.
    /// </summary>
    // S3776/S1541: The five distinct skip/continue branches (cutoff, stall, all-slots-full,
    // filter-excluded, already-full, unknown, zero-mapped) are all required for correct
    // backfill semantics.  Extracting them into sub-methods would destroy the shared
    // mutable state (filled, consecutiveNoProgress) without reducing real complexity.
    [SuppressMessage("SonarAnalyzer", "S3776", Justification = "Backfill scan loop: multiple mutually-exclusive skip branches share mutable stall/fill state; structural complexity is irreducible.")]
    [SuppressMessage("SonarAnalyzer", "S1541", Justification = "Backfill scan loop: multiple mutually-exclusive skip branches share mutable stall/fill state; structural complexity is irreducible.")]
    private async Task<List<(
            GhDeployment Deployment,
            List<GhDeploymentStatus> Statuses,
            long? RunId,
            WorkflowGraph? Graph,
            string Service)>>
        CollectChosenDeploymentsAsync(
            BackfillEnvContext ctx,
            IReadOnlyDictionary<string, string> pathToService,
            IReadOnlySet<string> allServiceNames,
            IReadOnlyDictionary<string, string> serviceMap,
            int depth,
            CancellationToken ct)
    {
        var chosen = new List<(
            GhDeployment Deployment,
            List<GhDeploymentStatus> Statuses,
            long? RunId,
            WorkflowGraph? Graph,
            string Service)>();

        var filled = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var consecutiveNoProgress = 0;

        await foreach (var deployment in github.GetPagedAsync<GhDeployment>(
            $"/repos/{ctx.Owner}/{ctx.RepoName}/deployments?environment={Uri.EscapeDataString(ctx.Env)}", ct))
        {
            if (deployment.CreatedAt < ctx.Cutoff)
                break;

            if (consecutiveNoProgress >= StallWindow)
            {
                logger.LogDebug(
                    "[Backfill] {Repo}/{Env}: stalled after {N} consecutive no-progress deployments",
                    ctx.Repo, ctx.Env, consecutiveNoProgress);
                break;
            }

            // All known service slots for this env are full — stop; nothing left to fill.
            // Starvation-safe: fires ONLY once EVERY known service reached depth (F13, #349),
            // so a quiet service that has not appeared yet (filled.Count < allServiceNames.Count)
            // is never cut off.
            if (allServiceNames.Count > 0
                && filled.Count == allServiceNames.Count
                && filled.Values.All(v => v >= depth))
            {
                logger.LogDebug(
                    "[Backfill] {Repo}/{Env}: all {N} service slots full — stopping scan",
                    ctx.Repo, ctx.Env, allServiceNames.Count);
                break;
            }

            var statuses = await FetchAllStatusesAsync(ctx.Owner, ctx.RepoName, deployment.Id, ct);
            var runId = statuses
                .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                .FirstOrDefault(r => r.HasValue);

            var (service, workflowName) = await ResolveServiceAndWorkflowFromRunAsync(
                ctx.Owner, ctx.RepoName, ctx.Repo, runId, pathToService, serviceMap, ct);

            // Apply workflow exclude filter: skip deployments whose workflow is excluded.
            // A filtered-out workflow produces no data for us, so it counts as no-progress
            // for the stall/early-exit logic — identical treatment to an unknown service.
            // This prevents a repo where every deployment maps to excluded workflows from
            // scanning all the way to the cutoff date instead of halting at the stall window.
            // When the workflow name is null (graph unavailable), only '*' patterns match — acceptable.
            if (workflowExcludeFilter.IsExcluded(ctx.Owner, ctx.RepoName, workflowName ?? string.Empty))
            {
                consecutiveNoProgress++;
                continue;
            }

            var eventsSoFar = filled.GetValueOrDefault(service, 0);

            // (a) Slot already full — skip silently; this is NOT no-progress (F13).
            if (allServiceNames.Contains(service) && eventsSoFar >= depth)
                continue;

            // (b) Unknown service — genuine no-data; bump stall counter.
            if (!allServiceNames.Contains(service))
            {
                consecutiveNoProgress++;
                continue;
            }

            var mappedCount = statuses.Count(s => StatusMapper.Map(s.State) is not null);

            // (c) Zero mapped statuses — genuine no-data; bump stall counter.
            if (mappedCount == 0)
            {
                consecutiveNoProgress++;
                continue;
            }

            WorkflowGraph? graph = null;
            if (runId.HasValue)
                graph = await graphCache.GetOrFetchGraphAsync(ctx.Owner, ctx.RepoName, runId.Value, github, ct);

            chosen.Add((deployment, statuses, runId, graph, service));
            filled[service] = eventsSoFar + mappedCount;
            consecutiveNoProgress = 0;
        }

        return chosen;
    }

    /// <summary>
    /// Pass 2: maps chosen deployments + their statuses to ingest events,
    /// refining failure status and resolving parent edges.
    /// </summary>
    private async Task<List<(DeploymentEventIngest Event, string Slot)>> BuildEnvEventsAsync(
        string owner, string repoName, string repo,
        List<(GhDeployment Deployment,
              List<GhDeploymentStatus> Statuses,
              long? RunId,
              WorkflowGraph? Graph,
              string Service)> chosen,
        IReadOnlyDictionary<string, string> serviceMap,
        Dictionary<long, Dictionary<string, string>> combinedMap,
        CancellationToken ct)
    {
        var candidateEvents = new List<(DeploymentEventIngest Event, string Slot)>();

        foreach (var (deployment, statuses, runId, graph, service) in chosen)
        {
            foreach (var status in statuses)
            {
                var contractStatus = StatusMapper.Map(status.State);
                if (contractStatus is null) continue;

                // Refine failure → cancelled/rejected by cross-referencing run conclusion + reviews.
                if (StatusMapper.IsFailureStatus(contractStatus))
                    contractStatus = await DeploymentMapper.ResolveFailureStatusAsync(
                        new DeploymentLookupContext(owner, repoName, deployment.Id, runId),
                        github, graphCache, logger, ct);

                var parentDeployments = DeploymentMapper.DeriveParents(deployment, runId, graph, combinedMap);
                var version = await versionResolver.ResolveAsync(owner, repoName, deployment, status, ct);

                var ev = EventMapper.Map(
                    deployment, status, repo, contractStatus,
                    new EventMappingContext(graph?.WorkflowName, version, parentDeployments, serviceMap));

                var slot = $"{service}\x00{deployment.Environment}";
                candidateEvents.Add((ev, slot));
            }
        }

        return candidateEvents;
    }

    /// <summary>
    /// Trims the candidate event list to at most <paramref name="depth"/> events per slot,
    /// keeping the most recent by <see cref="DeploymentEventIngest.HappenedAt"/>.
    /// </summary>
    internal static List<DeploymentEventIngest> TrimEventsBySlotDepth(
        List<(DeploymentEventIngest Event, string Slot)> candidateEvents,
        int depth)
    {
        var events = new List<DeploymentEventIngest>();
        foreach (var slotGroup in candidateEvents.GroupBy(x => x.Slot))
        {
            var kept = slotGroup
                .OrderByDescending(x => x.Event.HappenedAt)
                .Take(depth)
                .Select(x => x.Event);
            events.AddRange(kept);
        }
        return events;
    }

    // ── env-map helpers ───────────────────────────────────────────────────────

    internal static void MergeIntoRepoEnvMap(
        Dictionary<long, Dictionary<string, string>> target,
        List<(long Id, string Env, DateTimeOffset CreatedAt, long? RunId)> deployments) =>
        MergeIntoMap(target, deployments);

    private static void MergeIntoMap(
        Dictionary<long, Dictionary<string, string>> target,
        IEnumerable<(long Id, string Env, DateTimeOffset CreatedAt, long? RunId)> deployments)
    {
        var partial = ParentDerivation.BuildEnvToDeploymentIdMap(deployments);
        foreach (var (runId, envToId) in partial)
        {
            if (!target.TryGetValue(runId, out var existing))
            {
                target[runId] = envToId;
                continue;
            }
            // Merge; keep later CreatedAt wins (handled inside BuildEnvToDeploymentIdMap per runId,
            // but different envs within the same runId may arrive from different passes — apply
            // a simple "add if absent" merge since BuildEnvToDeploymentIdMap already handles
            // collision within a single call's deployment set).
            foreach (var (env, id) in envToId)
                existing.TryAdd(env, id);
        }
    }

    // ── per-deployment helpers ────────────────────────────────────────────────

    internal async Task<List<GhDeploymentStatus>> FetchAllStatusesAsync(
        string owner, string repoName, long deploymentId, CancellationToken ct)
    {
        var statuses = new List<GhDeploymentStatus>();
        await foreach (var s in github.GetPagedAsync<GhDeploymentStatus>(
            $"/repos/{owner}/{repoName}/deployments/{deploymentId}/statuses", ct))
            statuses.Add(s);
        return statuses;
    }

    internal async Task<(string Service, string? WorkflowName)> ResolveServiceAndWorkflowFromRunAsync(
        string owner, string repoName, string repo,
        long? runId,
        IReadOnlyDictionary<string, string> pathToService,
        IReadOnlyDictionary<string, string> serviceMap,
        CancellationToken ct)
    {
        if (!runId.HasValue)
            return (ServiceResolver.Resolve(null, repo, serviceMap), null);

        var (path, name) = await graphCache.GetOrFetchRunInfoAsync(owner, repoName, runId.Value, github, ct);
        var service = (path is not null && pathToService.TryGetValue(path, out var serviceFromPath))
            ? serviceFromPath
            : ServiceResolver.Resolve(name, repo, serviceMap);

        return (service, name);
    }
}
