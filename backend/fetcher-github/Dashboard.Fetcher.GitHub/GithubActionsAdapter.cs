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

        // Step 1: collect deployments in the window; fetch statuses only for non-terminal ones.
        var deployments = new List<GhDeployment>();
        var allStatuses = new Dictionary<long, List<GhDeploymentStatus>>();

        // Cached-terminal entries contribute to the parent map but produce no events.
        // Key: deploymentId, Value: runId extracted from the last status (may be null).
        var cachedTerminalRunIds = new Dictionary<long, long?>();

        await foreach (var d in github.GetPagedAsync<GhDeployment>(
            $"/repos/{owner}/{repoName}/deployments", ct))
        {
            if (d.CreatedAt < cutoff)
                break;

            deployments.Add(d);

            if (_terminalCache.TryGet(d.Id, out var cachedRunId))
            {
                // Already terminal: skip the /statuses fetch; retain for parent map.
                cachedTerminalRunIds[d.Id] = cachedRunId;
                continue;
            }

            var statuses = new List<GhDeploymentStatus>();
            await foreach (var s in github.GetPagedAsync<GhDeploymentStatus>(
                $"/repos/{owner}/{repoName}/deployments/{d.Id}/statuses", ct))
                statuses.Add(s);
            allStatuses[d.Id] = statuses;

            // Statuses are returned newest-first; the first entry is the latest.
            var latestStatus = statuses.Count > 0 ? statuses[0] : null;
            if (latestStatus is not null && TerminalDeploymentCache.IsTerminalState(latestStatus.State))
            {
                var extractedRunId = EventMapper.ExtractRunId(latestStatus.TargetUrl);
                _terminalCache.Record(d.Id, extractedRunId);
            }
        }

        // Step 2: build envToDeploymentId for parent derivation (§5.6.4).
        // Includes both freshly-fetched deployments AND cached-terminal ones so that
        // parent edges to finished environments remain resolvable in later cycles.
        var envMapEntries = deployments.SelectMany<GhDeployment, (long DeploymentId, string Environment, DateTimeOffset CreatedAt, long? RunId)>(d =>
        {
            if (cachedTerminalRunIds.TryGetValue(d.Id, out var cachedRunId))
            {
                // Cached-terminal: use the stored run_id directly.
                return [(d.Id, d.Environment, d.CreatedAt, cachedRunId)];
            }

            return allStatuses.GetValueOrDefault(d.Id, [])
                .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                .Where(r => r.HasValue)
                .Take(1)
                .Select(r => (d.Id, d.Environment, d.CreatedAt, r));
        });

        var envMap = ParentDerivation.BuildEnvToDeploymentIdMap(envMapEntries);

        // Step 3: map new status events (status.created_at > since).
        // Only freshly-fetched (non-terminal) deployments can have new events.
        var events = new List<DeploymentEventIngest>();
        var maxSince = since;

        foreach (var deployment in deployments)
        {
            if (cachedTerminalRunIds.ContainsKey(deployment.Id))
                continue; // terminal — all statuses are ≤ since; contributes no events

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
