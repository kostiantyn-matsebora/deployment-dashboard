using Dashboard.Fetcher.Abstractions;
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
///
/// Streaming + resumable (chunked backfill):
/// Yields one <see cref="FetchResult"/> per completed (repo, env) plus a zero-event
/// completion marker per repo.  The orchestrator persists the cursor after each chunk
/// so a mid-backfill crash resumes from the last completed env.
///
/// Parent-map choice: the per-repo envToDeploymentId map is accumulated as each env
/// completes within a repo (§5.6.4 cross-env edges). A parent deployment in an env
/// processed later becomes a forward reference that Swimlanes resolves at render time
/// (§5.6.5 — dangling ids are tolerated). Within-repo edges from earlier envs are
/// resolved correctly because all of those deployments are accumulated into the repo
/// map before emitting later-env events.
///
/// Empty-repo completion: when a repo has no emitted events (maxSince == null), the
/// completion marker emits without advancing repos[repo].since, so the next poll window
/// falls back to now − INITIAL_LOOKBACK (safe; avoids missing events in an empty repo).
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

    /// <summary>
    /// Streams backfill chunks — one per completed (repo, env) plus a zero-event
    /// completion marker per repo.  Each chunk carries the full running cursor so the
    /// orchestrator can persist it after every yield.
    /// </summary>
    public async IAsyncEnumerable<FetchResult> RunAsync(
        GithubCursor incoming,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        logger.LogInformation("[Backfill] starting (depth={Depth})", fetcherOptions.BackfillDepth);

        var cursor = incoming;
        var serviceMap = options.ServiceMapDict;
        var maxAge = fetcherOptions.EffectiveBackfillMaxAge;

        foreach (var repo in options.RepoList)
        {
            var (owner, repoName) = SplitRepo(repo);
            var existing = incoming.BackfillFor(repo);

            // Stable anchor: reuse the persisted anchor for a resume, set a fresh one otherwise.
            var anchor = existing?.Anchor ?? DateTimeOffset.UtcNow;
            var cutoff = anchor - maxAge;
            var alreadyDone = existing?.DoneEnvs ?? [];

            logger.LogInformation("[Backfill] {Repo}: anchor={Anchor}, resuming={Resume}, doneEnvs={Done}",
                repo, anchor, existing is not null, string.Join(",", alreadyDone));

            // Per-repo accumulated envToDeploymentId map for parent derivation (§5.6.4).
            // Built incrementally as each env's deployments are scanned so within-repo
            // edges from earlier envs resolve when later-env events reference them.
            var repoEnvMap = new Dictionary<long, Dictionary<string, string>>();

            DateTimeOffset? maxSinceForRepo = null;

            // Discover active workflows for service resolution.
            var workflowList = await github.GetAsync<GhWorkflowListResponse>(
                $"/repos/{owner}/{repoName}/actions/workflows?per_page=100", ct);
            var activeWorkflows = workflowList?.Workflows
                .Where(w => w.State == "active")
                .ToList() ?? [];

            var pathToService = activeWorkflows
                .ToDictionary(
                    w => w.Path,
                    w => ServiceResolver.Resolve(w.Name, repo, serviceMap),
                    StringComparer.OrdinalIgnoreCase);

            var allServiceNames = activeWorkflows
                .Select(w => ServiceResolver.Resolve(w.Name, repo, serviceMap))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            // Discover environments.
            var envList = await github.GetAsync<GhEnvironmentListResponse>(
                $"/repos/{owner}/{repoName}/environments", ct);
            var environments = envList?.Environments.Select(e => e.Name).ToList() ?? [];

            var remainingEnvs = environments
                .Where(e => !alreadyDone.Contains(e, StringComparer.OrdinalIgnoreCase))
                .ToList();

            foreach (var env in remainingEnvs)
            {
                ct.ThrowIfCancellationRequested();

                var (envEvents, envDeployments) = await BackfillEnvAsync(
                    owner, repoName, repo, env, cutoff,
                    pathToService, allServiceNames, serviceMap,
                    repoEnvMap, ct);

                // Accumulate deployment data into the repo-level env map so that
                // subsequent envs can resolve parent edges back to this env's deployments.
                MergeIntoRepoEnvMap(repoEnvMap, envDeployments);

                // Sort env events oldest-first (§5.8.2).
                envEvents.Sort((a, b) => a.HappenedAt.CompareTo(b.HappenedAt));

                foreach (var ev in envEvents)
                {
                    if (maxSinceForRepo is null || ev.HappenedAt > maxSinceForRepo.Value)
                        maxSinceForRepo = ev.HappenedAt;
                }

                // Advance the running cursor with the done-env marker.
                cursor = cursor.WithBackfillEnvDone(repo, anchor, env);

                yield return new FetchResult(envEvents, cursor.Encode());
            }

            // Zero-event completion marker: sets repos[repo].since and removes the backfill marker.
            cursor = cursor.WithBackfillComplete(repo, maxSinceForRepo);
            yield return new FetchResult([], cursor.Encode());

            logger.LogInformation("[Backfill] {Repo}: complete — maxSince={MaxSince}", repo, maxSinceForRepo);
        }

        logger.LogInformation("[Backfill] all repos complete");
    }

    // ── per-env scan ──────────────────────────────────────────────────────────

    /// <summary>
    /// Scans one environment and returns the trimmed events plus the raw deployment
    /// collection for the caller to merge into the repo env-map.
    /// </summary>
    private async Task<(List<DeploymentEventIngest> Events,
        List<(long Id, string Env, DateTimeOffset CreatedAt, long? RunId)> Deployments)>
        BackfillEnvAsync(
            string owner, string repoName, string repo, string env,
            DateTimeOffset cutoff,
            IReadOnlyDictionary<string, string> pathToService,
            IReadOnlySet<string> allServiceNames,
            IReadOnlyDictionary<string, string> serviceMap,
            Dictionary<long, Dictionary<string, string>> repoEnvMap,
            CancellationToken ct)
    {
        var depth = fetcherOptions.BackfillDepth > 0 ? fetcherOptions.BackfillDepth : 1;

        // Pass 1: collect chosen deployments for this env.
        var chosen = new List<(
            GhDeployment Deployment,
            List<GhDeploymentStatus> Statuses,
            long? RunId,
            WorkflowGraph? Graph,
            string Service)>();

        var filled = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var consecutiveNoProgress = 0;

        await foreach (var deployment in github.GetPagedAsync<GhDeployment>(
            $"/repos/{owner}/{repoName}/deployments?environment={Uri.EscapeDataString(env)}", ct))
        {
            if (deployment.CreatedAt < cutoff)
                break;

            if (consecutiveNoProgress >= StallWindow)
            {
                logger.LogDebug(
                    "[Backfill] {Repo}/{Env}: stalled after {N} consecutive no-progress deployments",
                    repo, env, consecutiveNoProgress);
                break;
            }

            var statuses = await FetchAllStatusesAsync(owner, repoName, deployment.Id, ct);
            var runId = statuses
                .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                .FirstOrDefault(r => r.HasValue);

            var service = await ResolveServiceFromRunAsync(
                owner, repoName, repo, runId, pathToService, serviceMap, ct);

            var eventsSoFar = filled.GetValueOrDefault(service, 0);
            if (!allServiceNames.Contains(service) || eventsSoFar >= depth)
            {
                consecutiveNoProgress++;
                continue;
            }

            var mappedCount = statuses.Count(s => StatusMapper.Map(s.State) is not null);
            if (mappedCount == 0)
            {
                consecutiveNoProgress++;
                continue;
            }

            WorkflowGraph? graph = null;
            if (runId.HasValue)
                graph = await graphCache.GetOrFetchGraphAsync(owner, repoName, runId.Value, github, ct);

            chosen.Add((deployment, statuses, runId, graph, service));
            filled[service] = eventsSoFar + mappedCount;
            consecutiveNoProgress = 0;
        }

        // Collect the raw deployment tuples for the caller to merge into the repo map.
        var deploymentTuples = chosen
            .Select(c => (c.Deployment.Id, c.Deployment.Environment, c.Deployment.CreatedAt, c.RunId))
            .ToList();

        // Build the env map using all known repo deployments so far PLUS this env's new ones.
        // This ensures parent edges from this env back to a prior env in the same run are resolved.
        var combinedMap = new Dictionary<long, Dictionary<string, string>>(repoEnvMap);
        MergeIntoMap(combinedMap, deploymentTuples);

        // Pass 2: build events and trim.
        var candidateEvents = new List<(DeploymentEventIngest Event, string Slot)>();

        foreach (var (deployment, statuses, runId, graph, service) in chosen)
        {
            foreach (var status in statuses)
            {
                var contractStatus = StatusMapper.Map(status.State);
                if (contractStatus is null) continue;

                // Refine failure → cancelled/rejected by cross-referencing run conclusion + reviews.
                if (contractStatus == DeploymentStatus.Failure)
                    contractStatus = await ResolveFailureStatusAsync(owner, repoName, deployment.Id, runId, ct);

                var parentDeployments = DeriveParents(deployment, runId, graph, combinedMap);
                var version = await versionResolver.ResolveAsync(owner, repoName, deployment, status, ct);

                var ev = EventMapper.Map(
                    deployment, status, repo, contractStatus,
                    graph?.WorkflowName, version, parentDeployments, serviceMap);

                var slot = $"{service}\x00{deployment.Environment}";
                candidateEvents.Add((ev, slot));
            }
        }

        var events = new List<DeploymentEventIngest>();
        foreach (var slotGroup in candidateEvents.GroupBy(x => x.Slot))
        {
            var kept = slotGroup
                .OrderByDescending(x => x.Event.HappenedAt)
                .Take(depth)
                .Select(x => x.Event);
            events.AddRange(kept);
        }

        return (events, deploymentTuples);
    }

    // ── env-map helpers ───────────────────────────────────────────────────────

    private static void MergeIntoRepoEnvMap(
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

    // ── helpers ───────────────────────────────────────────────────────────────

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
        => ParentDerivation.DeriveParents(deployment, runId, graph, envMap);

    private Task<string> ResolveFailureStatusAsync(
        string owner, string repoName, long deploymentId, long? runId, CancellationToken ct)
        => GithubStatusResolver.ResolveFailureStatusAsync(
            owner, repoName, deploymentId, runId, github, graphCache, logger, ct);

    private static (string Owner, string Repo) SplitRepo(string repo)
        => GithubAdapterOptions.SplitRepo(repo);
}
