using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Backfill;

/// <summary>
/// Fills the store with the most recent <see cref="FetcherOptions.BackfillDepth"/> status events
/// per (service, environment) slot (§5.8, F13).
/// Triggered on null cursor (first run) or BACKFILL=true (F14).
/// </summary>
public sealed class BackfillRunner(
    GithubClient github,
    GithubAdapterOptions options,
    FetcherOptions fetcherOptions,
    WorkflowGraphCache graphCache,
    VersionResolver versionResolver,
    ILogger<BackfillRunner> logger)
{
    /// <summary>
    /// Consecutive no-progress deployments before scanning stops for an environment (F1).
    /// A deployment makes no progress when its service is already at depth OR is unknown.
    /// </summary>
    private const int StallWindow = 20;

    public async Task<(IReadOnlyList<DeploymentEventIngest> Events, GithubCursor Cursor)> RunAsync(
        CancellationToken ct)
    {
        logger.LogInformation("[Backfill] starting (depth={Depth})", fetcherOptions.BackfillDepth);

        var allEvents = new List<DeploymentEventIngest>();
        var cursor = new GithubCursor();
        var serviceMap = options.ServiceMapDict;
        var maxAge = fetcherOptions.EffectiveBackfillMaxAge;

        foreach (var repo in options.RepoList)
        {
            var (owner, repoName) = SplitRepo(repo);
            var (events, maxSince) = await BackfillRepoAsync(
                owner, repoName, repo, serviceMap, maxAge, ct);
            allEvents.AddRange(events);

            if (maxSince.HasValue)
                cursor = cursor.WithRepo(repo, maxSince.Value);
        }

        // Sort oldest-first before returning (§5.8.2)
        allEvents.Sort((a, b) => a.HappenedAt.CompareTo(b.HappenedAt));

        logger.LogInformation("[Backfill] complete — {Count} events", allEvents.Count);
        return (allEvents, cursor);
    }

    private async Task<(List<DeploymentEventIngest> Events, DateTimeOffset? MaxSince)> BackfillRepoAsync(
        string owner, string repoName, string repo,
        IReadOnlyDictionary<string, string> serviceMap,
        TimeSpan maxAge, CancellationToken ct)
    {
        var depth = fetcherOptions.BackfillDepth > 0 ? fetcherOptions.BackfillDepth : 1;
        var cutoff = DateTimeOffset.UtcNow - maxAge;

        // Discover active workflows; build path→workflowName map for F2 service resolution.
        var workflowList = await github.GetAsync<GhWorkflowListResponse>(
            $"/repos/{owner}/{repoName}/actions/workflows?per_page=100", ct);
        var activeWorkflows = workflowList?.Workflows
            .Where(w => w.State == "active")
            .ToList() ?? [];

        // F2: path → resolved service name (avoids mis-mapping when run-name: is overridden)
        var pathToService = activeWorkflows
            .ToDictionary(
                w => w.Path,
                w => ServiceResolver.Resolve(w.Name, repo, serviceMap),
                StringComparer.OrdinalIgnoreCase);

        var allServiceNames = activeWorkflows
            .Select(w => ServiceResolver.Resolve(w.Name, repo, serviceMap))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Discover environments
        var envList = await github.GetAsync<GhEnvironmentListResponse>(
            $"/repos/{owner}/{repoName}/environments", ct);
        var environments = envList?.Environments.Select(e => e.Name).ToList() ?? [];

        // Pass 1: accumulate chosen deployments with their fetched data.
        // Parent derivation is deferred to pass 2 so the full cross-environment
        // envToDeploymentId map (§5.6.4) can be built before resolving any edges.
        //
        // filled[service] = count of MAPPED STATUS EVENTS kept so far for this env.
        // Scanning stops for a slot once filled[service] >= depth (event-count, not
        // deployment-count). The newest deployments are scanned first; we collect
        // all their mapped statuses and trim to the depth-latest after pass 2.
        var chosen = new List<(
            GhDeployment Deployment,
            List<GhDeploymentStatus> Statuses,
            long? RunId,
            WorkflowGraph? Graph,
            string? WorkflowName,
            string Service)>();

        foreach (var env in environments)
        {
            // filled[service] = count of mapped status events contributed to this env slot
            var filled = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var consecutiveNoProgress = 0;

            await foreach (var deployment in github.GetPagedAsync<GhDeployment>(
                $"/repos/{owner}/{repoName}/deployments?environment={Uri.EscapeDataString(env)}", ct))
            {
                if (deployment.CreatedAt < cutoff)
                    break;

                // F1 no-progress stop: abort env scan when stalled for StallWindow deployments.
                if (consecutiveNoProgress >= StallWindow)
                {
                    logger.LogDebug(
                        "[Backfill] {Repo}/{Env}: stalled after {N} consecutive no-progress deployments",
                        repo, env, consecutiveNoProgress);
                    break;
                }

                // Fetch statuses (always needed for event data and run_id extraction).
                var statuses = await FetchAllStatusesAsync(owner, repoName, deployment.Id, ct);
                var runId = statuses
                    .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                    .FirstOrDefault(r => r.HasValue);

                // F2: resolve service from run path → active-workflow name, not run.Name.
                // Only fetch run metadata (cheap); defer YAML until keep decision is made.
                var service = await ResolveServiceFromRunAsync(
                    owner, repoName, repo, runId, pathToService, serviceMap, ct);

                var eventsSoFar = filled.GetValueOrDefault(service, 0);
                if (!allServiceNames.Contains(service) || eventsSoFar >= depth)
                {
                    consecutiveNoProgress++;
                    continue;
                }

                // Count how many additional mapped events this deployment would contribute.
                var mappedCount = statuses.Count(s => StatusMapper.Map(s.State) is not null);
                if (mappedCount == 0)
                {
                    consecutiveNoProgress++;
                    continue;
                }

                // Kept: fetch the full workflow graph (YAML) for parent derivation.
                WorkflowGraph? graph = null;
                if (runId.HasValue)
                    graph = await graphCache.GetOrFetchGraphAsync(owner, repoName, runId.Value, github, ct);

                var workflowName = graph?.WorkflowName;

                chosen.Add((deployment, statuses, runId, graph, workflowName, service));
                filled[service] = eventsSoFar + mappedCount;
                consecutiveNoProgress = 0; // progress was made

                logger.LogDebug(
                    "[Backfill] {Repo}/{Env}: kept deployment {Id} for service '{Service}' ({EventCount} events so far / {Depth})",
                    repo, env, deployment.Id, service, filled[service], depth);
            }
        }

        // Pass 2: build the full cross-environment envToDeploymentId map from ALL chosen
        // deployments (§5.6.4), then derive parents and build events.
        var envMap = ParentDerivation.BuildEnvToDeploymentIdMap(
            chosen.Select(c => (c.Deployment.Id, c.Deployment.Environment, c.Deployment.CreatedAt, c.RunId)));

        // Collect all candidate events before trimming to depth latest per slot.
        var candidateEvents = new List<(DeploymentEventIngest Event, string Slot)>();
        DateTimeOffset? maxSince = null;

        foreach (var (deployment, statuses, runId, graph, workflowName, service) in chosen)
        {
            foreach (var status in statuses)
            {
                var contractStatus = StatusMapper.Map(status.State);
                if (contractStatus is null) continue;

                var parentDeployments = DeriveParents(deployment, runId, graph, envMap);
                var version = await versionResolver.ResolveAsync(
                    owner, repoName, deployment, status, ct);

                var ev = EventMapper.Map(
                    deployment, status, repo, contractStatus,
                    workflowName, version, parentDeployments, serviceMap);

                // Slot key for per-slot depth trimming.
                var slot = $"{service}\x00{deployment.Environment}";
                candidateEvents.Add((ev, slot));
            }
        }

        // Trim to the BackfillDepth latest events per (service, environment) slot
        // by status created_at, then advance the cursor over what is actually emitted.
        var events = new List<DeploymentEventIngest>();

        var bySlot = candidateEvents
            .GroupBy(x => x.Slot)
            .ToList();

        foreach (var slotGroup in bySlot)
        {
            // Order by HappenedAt descending, keep the depth latest, then sort ascending
            // for the final post ordering (§5.8.2 oldest-first).
            var kept = slotGroup
                .OrderByDescending(x => x.Event.HappenedAt)
                .Take(depth)
                .Select(x => x.Event)
                .ToList();

            events.AddRange(kept);
        }

        // Advance cursor over all emitted events.
        foreach (var ev in events)
        {
            // NOTE: maxSince is DateTimeOffset? — a lifted `>` against null is always
            // false, so the null case must be handled explicitly or the cursor never
            // advances (backfill would return an empty cursor → next poll re-scans the
            // whole INITIAL_LOOKBACK window).
            if (maxSince is null || ev.HappenedAt > maxSince.Value)
                maxSince = ev.HappenedAt;
        }

        return (events, maxSince);
    }

    /// <summary>
    /// Resolves the service name using the run's <c>path</c> field (F2).
    /// Looks up the path in the pre-built active-workflow path→service map.
    /// Falls back to <see cref="ServiceResolver.Resolve"/> with the run's display name,
    /// then to repo short name.
    /// </summary>
    private async Task<string> ResolveServiceFromRunAsync(
        string owner, string repoName, string repo,
        long? runId,
        IReadOnlyDictionary<string, string> pathToService,
        IReadOnlyDictionary<string, string> serviceMap,
        CancellationToken ct)
    {
        if (!runId.HasValue)
            return ServiceResolver.Resolve(null, repo, serviceMap);

        var run = await graphCache.GetOrFetchRunAsync(owner, repoName, runId.Value, github, ct);
        if (run is not null && pathToService.TryGetValue(run.Path, out var serviceFromPath))
            return serviceFromPath;

        // Fallback: run display name (may be run-name: override, but better than nothing).
        return ServiceResolver.Resolve(run?.Name, repo, serviceMap);
    }

    private async Task<List<GhDeploymentStatus>> FetchAllStatusesAsync(
        string owner, string repoName, long deploymentId, CancellationToken ct)
    {
        var statuses = new List<GhDeploymentStatus>();
        await foreach (var s in github.GetPagedAsync<GhDeploymentStatus>(
            $"/repos/{owner}/{repoName}/deployments/{deploymentId}/statuses", ct))
            statuses.Add(s);
        return statuses;
    }

    private static string[] DeriveParents(
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

    private static (string Owner, string Repo) SplitRepo(string repo)
    {
        var parts = repo.Split('/', 2);
        return parts.Length == 2 ? (parts[0], parts[1]) : ("", repo);
    }
}
