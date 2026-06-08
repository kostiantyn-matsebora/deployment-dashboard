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
            var since = cursor.SinceFor(repo, fetcherOptions.InitialLookback, fetcherOptions.UtcNow);
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
        var ctx = new RepoFetchContext(owner, repoName, repo, since);

        // Step 1: collect deployments in the window via conditional list request (F8 / §5.4).
        var deployments = await FetchDeploymentsWindowAsync(owner, repoName, repo, cutoff, ct);

        // Step 2: fetch statuses for each deployment (conditional for in-flight, skip for terminal).
        var (reusedRunIds, allStatuses) = await FetchDeploymentStatusesAsync(owner, repoName, deployments, ct);

        // Step 3: build envToDeploymentId for parent derivation (§5.6.4).
        var envMap = BuildEnvMap(deployments, reusedRunIds, allStatuses);

        // Step 4: map new status events (status.created_at > since).
        return await MapStatusEventsAsync(ctx, serviceMap, deployments, reusedRunIds, allStatuses, envMap, ct);
    }

    /// <summary>
    /// Fetches the deployments list for a repo using a conditional request (F8 / §5.5.2).
    /// On 304, reuses the cached snapshot (newest-first, already windowed).
    /// On 200, paginates only until the cutoff is crossed (early-stop, newest-first) and
    /// caches the windowed result when an ETag is present.
    /// </summary>
    private async Task<List<GhDeployment>> FetchDeploymentsWindowAsync(
        string owner, string repoName, string repo, DateTimeOffset cutoff, CancellationToken ct)
    {
        _deploymentsListCache.TryGet(repo, out var cached);

        var result = await github.GetPagedConditionalAsync<GhDeployment>(
            $"/repos/{owner}/{repoName}/deployments",
            cached.ETag, ct,
            stopBefore: d => d.CreatedAt < cutoff);

        if (result.NotModified)
            return new List<GhDeployment>(cached.Deployments);

        var windowed = new List<GhDeployment>(result.Items);

        if (result.ETag is not null)
            _deploymentsListCache.Set(repo, (result.ETag, windowed));

        return windowed;
    }

    /// <summary>
    /// Fetches statuses for each deployment: skips terminal (cache hit), reuses ETag-304 hits,
    /// and issues a conditional HTTP request for in-flight deployments.
    /// Returns the reused-run-id map and the freshly-fetched status lists.
    /// </summary>
    private async Task<(Dictionary<long, long?> ReusedRunIds, Dictionary<long, List<GhDeploymentStatus>> AllStatuses)>
        FetchDeploymentStatusesAsync(
            string owner, string repoName,
            List<GhDeployment> deployments, CancellationToken ct)
    {
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

            // Select the true latest by created_at — the endpoint's array ordering is not guaranteed.
            var latestStatus = statuses.Count > 0 ? statuses.MaxBy(s => s.CreatedAt) : null;
            var extractedRunId = latestStatus is not null
                ? EventMapper.ExtractRunId(latestStatus.TargetUrl)
                : null;

            if (result.ETag is not null)
                _statusEtagCache.Set(d.Id, (result.ETag, extractedRunId));

            if (latestStatus is not null && TerminalDeploymentCache.IsTerminalState(latestStatus.State))
                _terminalCache.Record(d.Id, extractedRunId);
        }

        return (reusedRunIds, allStatuses);
    }

    /// <summary>
    /// Builds the env→deploymentId map used for parent derivation (§5.6.4).
    /// Includes freshly-fetched, cached-terminal, and etag-304-reused deployments
    /// so that parent edges to finished/unchanged environments remain resolvable.
    /// </summary>
    private static Dictionary<long, Dictionary<string, string>> BuildEnvMap(
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
    /// Maps freshly-fetched deployment statuses created after <paramref name="since"/> into
    /// ingest events. Fetches workflow graphs and resolves versions per status.
    /// Skips terminal-cache and ETag-304 deployments (their statuses were not re-fetched).
    /// </summary>
    private async Task<(List<DeploymentEventIngest> Events, DateTimeOffset MaxSince)> MapStatusEventsAsync(
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
    private async Task<(DeploymentEventIngest Event, DateTimeOffset At)?> MapOneStatusAsync(
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

        // Refine failure → cancelled/rejected by cross-referencing run conclusion + reviews.
        if (contractStatus == DeploymentStatus.Failure)
            contractStatus = await ResolveFailureStatusAsync(ctx.Owner, ctx.RepoName, deployment.Id, runId, ct);

        var parentDeployments = DeriveParents(deployment, runId, graph, envMap);

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

    // ── helpers ───────────────────────────────────────────────────────────────

    private static string[] DeriveParents(
        GhDeployment deployment,
        long? runId,
        WorkflowGraph? graph,
        Dictionary<long, Dictionary<string, string>> envMap) =>
        DeploymentMapper.DeriveParents(deployment, runId, graph, envMap);

    /// <summary>
    /// Refines a raw-GitHub <c>failure</c>/<c>error</c> status to the correct contract status:
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
    private Task<string> ResolveFailureStatusAsync(
        string owner, string repoName, long deploymentId, long? runId, CancellationToken ct) =>
        DeploymentMapper.ResolveFailureStatusAsync(
            new DeploymentLookupContext(owner, repoName, deploymentId, runId), github, graphCache, logger, ct);

    private static (string Owner, string Repo) SplitRepo(string repo)
    {
        var parts = repo.Split('/', 2);
        return parts.Length == 2 ? (parts[0], parts[1]) : ("", repo);
    }
}

/// <summary>
/// Scalar context for a single repo poll cycle — owner, repo name, repo slug, and since cursor.
/// Groups the 4 scalars passed into MapStatusEventsAsync to reduce the parameter list.
/// </summary>
internal readonly record struct RepoFetchContext(
    string Owner,
    string RepoName,
    string Repo,
    DateTimeOffset Since);
