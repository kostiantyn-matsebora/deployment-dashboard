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
    public string AdapterId => "github-actions";

    public async Task<FetchResult> FetchAsync(string? cursor, CancellationToken ct)
    {
        var shouldBackfill = cursor is null || fetcherOptions.Backfill;

        if (shouldBackfill)
        {
            var (events, newCursor) = await backfillRunner.RunAsync(ct);
            return new FetchResult(events, newCursor.Encode());
        }

        return await PollAsync(GithubCursor.Decode(cursor), ct);
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

        // Step 1: collect deployments and statuses in the window
        var deployments = new List<GhDeployment>();
        var allStatuses = new Dictionary<long, List<GhDeploymentStatus>>();

        await foreach (var d in github.GetPagedAsync<GhDeployment>(
            $"/repos/{owner}/{repoName}/deployments", ct))
        {
            if (d.CreatedAt < cutoff)
                break;

            deployments.Add(d);
            var statuses = new List<GhDeploymentStatus>();
            await foreach (var s in github.GetPagedAsync<GhDeploymentStatus>(
                $"/repos/{owner}/{repoName}/deployments/{d.Id}/statuses", ct))
                statuses.Add(s);
            allStatuses[d.Id] = statuses;
        }

        // Step 2: build envToDeploymentId for parent derivation (§5.6.4)
        var envMap = ParentDerivation.BuildEnvToDeploymentIdMap(
            deployments.SelectMany(d =>
                allStatuses.GetValueOrDefault(d.Id, [])
                    .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                    .Where(r => r.HasValue)
                    .Take(1)
                    .Select(r => (d.Id, d.Environment, d.CreatedAt, r))));

        // Step 3: map new status events (status.created_at > since)
        var events = new List<DeploymentEventIngest>();
        var maxSince = since;

        foreach (var deployment in deployments)
        {
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
