using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// GitHub Deployments + Deployment Statuses REST API adapter (§5, F4).
/// AdapterId = "github-actions". All GitHub-specific logic is encapsulated here.
/// </summary>
public sealed class GithubActionsAdapter(
    GithubClient github,
    GithubAdapterOptions options,
    FetcherOptions fetcherOptions,
    BackfillRunner backfillRunner,
    DeploymentStatusEventMapper statusEventMapper) : ICiCdAdapter
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
        var envMap = DeploymentStatusEventMapper.BuildEnvMap(deployments, reusedRunIds, allStatuses);

        // Step 4: map new status events (status.created_at > since).
        return await statusEventMapper.MapStatusEventsAsync(ctx, serviceMap, deployments, reusedRunIds, allStatuses, envMap, ct);
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

    // ── helpers ───────────────────────────────────────────────────────────────

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
