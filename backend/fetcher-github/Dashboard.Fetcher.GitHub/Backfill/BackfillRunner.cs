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
/// Fills the store with the most recent deployment per (service, environment) slot (§5.8).
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
    public async Task<(IReadOnlyList<DeploymentEventIngest> Events, GithubCursor Cursor)> RunAsync(
        CancellationToken ct)
    {
        logger.LogInformation("[Backfill] starting");

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
        var cutoff = DateTimeOffset.UtcNow - maxAge;

        // Discover active workflows
        var workflowList = await github.GetAsync<GhWorkflowListResponse>(
            $"/repos/{owner}/{repoName}/actions/workflows?per_page=100", ct);
        var activeWorkflows = workflowList?.Workflows
            .Where(w => w.State == "active")
            .ToList() ?? [];

        var allServiceNames = activeWorkflows
            .Select(w => ServiceResolver.Resolve(w.Name, repo, serviceMap))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Discover environments
        var envList = await github.GetAsync<GhEnvironmentListResponse>(
            $"/repos/{owner}/{repoName}/environments", ct);
        var environments = envList?.Environments.Select(e => e.Name).ToList() ?? [];

        var events = new List<DeploymentEventIngest>();
        DateTimeOffset? maxSince = null;

        foreach (var env in environments)
        {
            var filled = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            await foreach (var deployment in github.GetPagedAsync<GhDeployment>(
                $"/repos/{owner}/{repoName}/deployments?environment={Uri.EscapeDataString(env)}", ct))
            {
                if (deployment.CreatedAt < cutoff)
                    break;

                var statuses = await FetchAllStatusesAsync(owner, repoName, deployment.Id, ct);
                var runId = statuses
                    .Select(s => EventMapper.ExtractRunId(s.TargetUrl))
                    .FirstOrDefault(r => r.HasValue);

                var graph = runId.HasValue
                    ? await graphCache.GetOrFetchGraphAsync(owner, repoName, runId.Value, github, ct)
                    : null;

                var workflowName = graph?.WorkflowName;
                var service = ServiceResolver.Resolve(workflowName, repo, serviceMap);

                if (!allServiceNames.Contains(service) || filled.Contains(service))
                    continue;

                var envMap = ParentDerivation.BuildEnvToDeploymentIdMap(
                    [(deployment.Id, deployment.Environment, deployment.CreatedAt, runId)]);

                foreach (var status in statuses)
                {
                    var contractStatus = StatusMapper.Map(status.State);
                    if (contractStatus is null) continue;

                    var parentDeployments = DeriveParents(deployment, runId, graph, envMap);
                    var version = await versionResolver.ResolveAsync(
                        owner, repoName, deployment, status, ct);

                    events.Add(EventMapper.Map(
                        deployment, status, repo, contractStatus,
                        workflowName, version, parentDeployments, serviceMap));

                    if (status.CreatedAt > maxSince)
                        maxSince = status.CreatedAt;
                }

                filled.Add(service);

                if (filled.Count == allServiceNames.Count)
                    break;
            }
        }

        return (events, maxSince);
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
