using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// GitHub Deployments + Deployment Statuses REST API adapter (§5, F4).
/// AdapterId = "github-actions". All GitHub-specific logic is encapsulated here.
/// </summary>
public sealed class GithubActionsAdapter(
    GithubClient github,
    GithubAdapterOptions options,
    FetcherOptions fetcherOptions,
    WorkflowGraphCache graphCache,
    VersionResolver versionResolver,
    BackfillRunner backfillRunner,
    ILogger<GithubActionsAdapter> logger) : ICiCdAdapter
{
    // Persists across poll cycles (adapter is a DI singleton) — see §5.5 poll-efficiency note.
    private readonly TerminalDeploymentCache _terminalCache = new();

    // repo → (etag, windowed deployments snapshot from the last 200) — §5.4/F8.
    private readonly BoundedLruCache<string, (string ETag, IReadOnlyList<GhDeployment> Deployments)>
        _deploymentsListCache = new(64);

    // deploymentId → (etag, runId?) for in-flight (non-terminal) deployments — §5.4/F8.
    private readonly BoundedLruCache<long, (string ETag, long? RunId)>
        _statusEtagCache = new(2000);

    public string AdapterId => "github-actions";

    public async IAsyncEnumerable<FetchResult> FetchAsync(
        string? cursor,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var decoded = GithubCursor.Decode(cursor);

        // Backfill when: no cursor, BACKFILL=true flag, or an active backfill marker exists (resume).
        var shouldBackfill = cursor is null || fetcherOptions.Backfill || decoded.IsBackfilling;

        if (shouldBackfill)
        {
            await foreach (var chunk in backfillRunner.RunAsync(decoded, ct))
                yield return chunk;
            yield break;
        }

        yield return await PollAsync(decoded, ct);
    }

    // ── normal poll ───────────────────────────────────────────────────────────

    private async Task<FetchResult> PollAsync(GithubCursor cursor, CancellationToken ct)
    {
        var allEvents = new List<DeploymentEventIngest>();
        var newCursor = cursor;

        foreach (var repo in options.RepoList)
        {
            var since = cursor.SinceFor(repo, fetcherOptions.InitialLookback);
            var (events, maxSince) = await PollRepoAsync(repo, since, ct);
            allEvents.AddRange(events);

            if (maxSince > since)
                newCursor = newCursor.WithRepo(repo, maxSince);
        }

        allEvents.Sort((a, b) => a.HappenedAt.CompareTo(b.HappenedAt));
        return new FetchResult(allEvents, newCursor.Encode());
    }

    private async Task<(List<DeploymentEventIngest> Events, DateTimeOffset MaxSince)> PollRepoAsync(
        string repo, DateTimeOffset since, CancellationToken ct)
    {
        var (owner, repoName) = SplitRepo(repo);
        var serviceMap = options.ServiceMapDict;
        var cutoff = since - TimeSpan.FromDays(1);  // margin for delayed status events

        // Step 1: collect deployments in the window via conditional list request (F8 / §5.4).
        var deployments = await FetchDeploymentsWindowAsync(owner, repoName, repo, cutoff, ct);

        // Step 2: fetch statuses for each deployment (conditional for in-flight, skip for terminal).
        // reusedRunIds: deployments whose statuses were NOT re-fetched this cycle but whose
        // run_id is known — both terminal-cache hits AND etag-304 hits populate this map.
        // Used to build the env→deploymentId map (§5.6.4) and to skip event emission.
        var reusedRunIds = new Dictionary<long, long?>();
        var allStatuses = new Dictionary<long, List<GhDeploymentStatus>>();

        foreach (var d in deployments)
        {
            if (_terminalCache.TryGet(d.Id, out var terminalRunId))
            {
                // Already terminal: skip HTTP entirely; retain for parent map.
                reusedRunIds[d.Id] = terminalRunId;
                continue;
            }

            _statusEtagCache.TryGet(d.Id, out var cached);
            var result = await github.GetPagedConditionalAsync<GhDeploymentStatus>(
                $"/repos/{owner}/{repoName}/deployments/{d.Id}/statuses",
                cached.ETag, ct);

            if (result.NotModified)
            {
                // Statuses unchanged: reuse the cached run_id for the env map; emit no events.
                reusedRunIds[d.Id] = cached.RunId;
                continue;
            }

            var statuses = new List<GhDeploymentStatus>(result.Items);
            allStatuses[d.Id] = statuses;

            // Statuses are returned newest-first; the first entry is the latest.
            var latestStatus = statuses.Count > 0 ? statuses[0] : null;
            var extractedRunId = latestStatus is not null
                ? EventMapper.ExtractRunId(latestStatus.TargetUrl)
                : null;

            if (result.ETag is not null)
                _statusEtagCache.Set(d.Id, (result.ETag, extractedRunId));

            if (latestStatus is not null && TerminalDeploymentCache.IsTerminalState(latestStatus.State))
                _terminalCache.Record(d.Id, extractedRunId);
        }

        // Step 3: build envToDeploymentId for parent derivation (§5.6.4).
        // Includes freshly-fetched, cached-terminal, and etag-304-reused deployments
        // so that parent edges to finished/unchanged environments remain resolvable.
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

        var envMap = ParentDerivation.BuildEnvToDeploymentIdMap(envMapEntries);

        // Step 4: map new status events (status.created_at > since).
        // Only freshly-fetched (non-terminal, non-304) deployments can have new events.
        var events = new List<DeploymentEventIngest>();
        var maxSince = since;

        foreach (var deployment in deployments)
        {
            if (reusedRunIds.ContainsKey(deployment.Id))
                continue; // terminal or 304 — statuses not re-fetched, no new events

            var statuses = allStatuses.GetValueOrDefault(deployment.Id, []);

            foreach (var status in statuses)
            {
                if (status.CreatedAt <= since)
                    continue;

                var contractStatus = StatusMapper.Map(status.State);
                if (contractStatus is null)
                    continue;

                var runId = EventMapper.ExtractRunId(status.TargetUrl);
                WorkflowGraph? graph = null;
                if (runId.HasValue)
                {
                    try
                    {
                        graph = await graphCache.GetOrFetchGraphAsync(
                            owner, repoName, runId.Value, github, ct);
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex,
                            "[{Repo}] workflow graph fetch failed for run {RunId}", repo, runId);
                    }
                }

                var parentDeployments = DeriveParents(deployment, runId, graph, envMap);

                string? version = null;
                try
                {
                    version = await versionResolver.ResolveAsync(
                        owner, repoName, deployment, status, ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex,
                        "[{Repo}] version resolution failed for deployment {Id}", repo, deployment.Id);
                }

                events.Add(EventMapper.Map(
                    deployment, status, repo, contractStatus,
                    graph?.WorkflowName, version, parentDeployments, serviceMap));

                if (status.CreatedAt > maxSince)
                    maxSince = status.CreatedAt;
            }
        }

        return (events, maxSince);
    }

    /// <summary>
    /// Fetches the deployments list for a repo using a conditional request (F8).
    /// On 304, reuses the cached snapshot (newest-first, already windowed).
    /// On 200, fetches fresh items, applies the cutoff window, and caches when an ETag is present.
    /// </summary>
    private async Task<List<GhDeployment>> FetchDeploymentsWindowAsync(
        string owner, string repoName, string repo, DateTimeOffset cutoff, CancellationToken ct)
    {
        _deploymentsListCache.TryGet(repo, out var cached);

        var result = await github.GetPagedConditionalAsync<GhDeployment>(
            $"/repos/{owner}/{repoName}/deployments",
            cached.ETag, ct);

        if (result.NotModified)
            return new List<GhDeployment>(cached.Deployments);

        // Apply window cutoff — items are newest-first from GitHub.
        var windowed = new List<GhDeployment>();
        foreach (var d in result.Items)
        {
            if (d.CreatedAt < cutoff)
                break;
            windowed.Add(d);
        }

        if (result.ETag is not null)
            _deploymentsListCache.Set(repo, (result.ETag, windowed));

        return windowed;
    }

    // ── helpers ───────────────────────────────────────────────────────────────

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
