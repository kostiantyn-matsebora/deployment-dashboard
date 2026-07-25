using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

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
    DeploymentStatusEventMapper statusEventMapper,
    ILogger<GithubActionsAdapter>? logger = null) : ICiCdAdapter
{
    // Defaults to a no-op sink so existing call sites that predate the recover guardrail
    // (added for issue #423) keep compiling without threading a logger through.
    private readonly ILogger<GithubActionsAdapter> _logger =
        logger ?? NullLogger<GithubActionsAdapter>.Instance;

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

        // Backfill when: no cursor, a semantically-empty cursor (no repo high-water marks —
        // e.g. right after a reset, or after an empty backfill that found no events), the
        // BACKFILL flag, or an active backfill marker (resume). Treating an empty cursor as a
        // first run keeps a reset a true clean slate: data that (re-)appears afterwards is
        // fully backfilled instead of being missed by incremental polling (§5.10.5).
        var shouldBackfill = cursor is null || decoded.IsEmpty || fetcherOptions.Backfill || decoded.IsBackfilling;

        if (shouldBackfill)
        {
            await foreach (var chunk in backfillRunner.RunAsync(decoded, ct))
                yield return chunk;
            yield break;
        }

        yield return await PollAsync(decoded, ct);
    }

    /// <summary>
    /// Reset saga (§5.10.5): drop all dedup caches so the post-reset backfill re-emits
    /// every deployment from a clean slate. Without this, the terminal-deployment and
    /// ETag caches survive the reset and suppress re-emission (304 / terminal-skip).
    /// </summary>
    public void ResetState()
    {
        _terminalCache.Clear();
        _deploymentsListCache.Clear();
        _statusEtagCache.Clear();
    }

    /// <summary>
    /// Recover saga (§5.10.6): builds a rewound cursor with every configured repo's
    /// high-water mark set to <paramref name="since"/> and no backfill markers, so the
    /// caller's next <see cref="FetchAsync"/> call takes the incremental <see cref="PollAsync"/>
    /// branch — recovery is non-destructive and must NEVER re-enter backfill. Also clears the
    /// windowed dedup caches (same effect as <see cref="ResetState"/>) so a warm
    /// conditional-request hit does not reuse the narrow pre-rewind window and miss the gap
    /// being recovered.
    /// Guardrail: when <c>FetcherOptions.Backfill</c> is true, the rewound cursor is still
    /// returned (so the cursor persisted is correct), but the very next
    /// <see cref="FetchAsync"/> will re-enter backfill regardless (the BACKFILL flag forces
    /// <c>shouldBackfill</c>), discarding the rewind — logged here as a warning.
    /// </summary>
    public string RewindTo(DateTimeOffset since)
    {
        ResetState();

        if (fetcherOptions.Backfill)
        {
            _logger.LogWarning(
                "[{Adapter}] recover rewind requested while BACKFILL=true; the rewound cursor " +
                "will be discarded — the next fetch re-enters backfill and re-advances since " +
                "from scratch instead of resuming incrementally",
                AdapterId);
        }

        var rewound = new GithubCursor();
        foreach (var repo in options.RepoList)
            rewound = rewound.WithRepo(repo, since);

        return rewound.Encode();
    }

    // ── normal poll ───────────────────────────────────────────────────────────

    private async Task<FetchResult> PollAsync(GithubCursor cursor, CancellationToken ct)
    {
        var allEvents = new List<DeploymentEventIngest>();
        var newCursor = cursor;

        foreach (var repo in options.RepoList)
        {
            var since = cursor.SinceFor(repo, fetcherOptions.InitialLookback, fetcherOptions.UtcNow);
            var prevPending = cursor.OldestPendingFor(repo);
            var (events, maxSince, oldestPending) = await PollRepoAsync(repo, since, prevPending, ct);
            allEvents.AddRange(events);

            // newSince never regresses: advance only when a later high-water mark was observed.
            var newSince = maxSince > since ? maxSince : since;

            // Write the cursor entry when: the high-water mark advanced, there is a pending
            // floor to store this cycle, or there was one last cycle that now needs clearing.
            if (newSince > since || oldestPending is not null || prevPending is not null)
                newCursor = newCursor.WithRepoState(repo, newSince, oldestPending);
        }

        allEvents.Sort((a, b) => a.HappenedAt.CompareTo(b.HappenedAt));
        return new FetchResult(allEvents, newCursor.Encode());
    }

    private async Task<(List<DeploymentEventIngest> Events, DateTimeOffset MaxSince, DateTimeOffset? OldestPending)> PollRepoAsync(
        string repo, DateTimeOffset since, DateTimeOffset? oldestPending, CancellationToken ct)
    {
        var (owner, repoName) = SplitRepo(repo);
        var serviceMap = options.ServiceMapDict;

        // Base floor: 1 day before the high-water mark to cover delayed status events.
        var floor = since - TimeSpan.FromDays(1);

        // Extend the cutoff to include any deployment that was still pending last cycle —
        // this prevents long-running approval-gated deployments from being evicted before
        // their terminal status arrives (fix for GitHub issue #407).
        var cutoff = oldestPending.HasValue && oldestPending.Value < floor ? oldestPending.Value : floor;

        var ctx = new RepoFetchContext(owner, repoName, repo, since);

        // Step 1: collect deployments in the window via conditional list request (F8 / §5.4).
        var deployments = await FetchDeploymentsWindowAsync(owner, repoName, repo, cutoff, ct);

        // Step 2: fetch statuses for each deployment (conditional for in-flight, skip for terminal).
        var (reusedRunIds, allStatuses, pendingCreatedAts) = await FetchDeploymentStatusesAsync(owner, repoName, deployments, ct);

        // Step 3: build envToDeploymentId for parent derivation (§5.6.4).
        var envMap = DeploymentStatusEventMapper.BuildEnvMap(deployments, reusedRunIds, allStatuses);

        // Step 4: map new status events (status.created_at > since).
        var (events, maxSince) = await statusEventMapper.MapStatusEventsAsync(ctx, serviceMap, deployments, reusedRunIds, allStatuses, envMap, ct);

        // Compute the new floor: the earliest created_at among still-pending deployments this
        // cycle.  Null = all in-window deployments are terminal — clear the stored floor.
        var newOldestPending = pendingCreatedAts.Count > 0 ? pendingCreatedAts.Min() : (DateTimeOffset?)null;

        return (events, maxSince, newOldestPending);
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
    /// Returns the reused-run-id map, the freshly-fetched status lists, and the list of
    /// <c>created_at</c> timestamps for deployments that are still non-terminal this cycle
    /// (used to compute the pending-floor cursor entry — §5.4 / fix for issue #407).
    /// </summary>
    private async Task<(Dictionary<long, long?> ReusedRunIds, Dictionary<long, List<GhDeploymentStatus>> AllStatuses, List<DateTimeOffset> PendingCreatedAts)>
        FetchDeploymentStatusesAsync(
            string owner, string repoName,
            List<GhDeployment> deployments, CancellationToken ct)
    {
        // reusedRunIds: deployments whose statuses were NOT re-fetched this cycle but whose
        // run_id is known — both terminal-cache hits AND etag-304 hits populate this map.
        // Used to build the env→deploymentId map (§5.6.4) and to skip event emission.
        var reusedRunIds = new Dictionary<long, long?>();
        var allStatuses = new Dictionary<long, List<GhDeploymentStatus>>();

        // PendingCreatedAts: created_at of every non-terminal deployment in the window.
        // A deployment with zero statuses is NOT considered pending to avoid leaking a
        // stale floor; the 1-day base floor already covers brand-new deployments.
        var pendingCreatedAts = new List<DateTimeOffset>();

        foreach (var d in deployments)
        {
            if (_terminalCache.TryGet(d.Id, out var terminalRunId))
            {
                // Already terminal: skip HTTP entirely; retain for parent map. NOT pending.
                reusedRunIds[d.Id] = terminalRunId;
                continue;
            }

            _statusEtagCache.TryGet(d.Id, out var cached);
            var result = await github.GetPagedConditionalAsync<GhDeploymentStatus>(
                $"/repos/{owner}/{repoName}/deployments/{d.Id}/statuses",
                cached.ETag, ct);

            if (result.NotModified)
            {
                // Statuses byte-identical: reuse cached run_id for the env map; emit no events.
                // Reached only when NOT terminal-cached → the deployment is still non-terminal.
                reusedRunIds[d.Id] = cached.RunId;
                pendingCreatedAts.Add(d.CreatedAt);
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
            {
                // Latest status is terminal — record in terminal cache. NOT pending.
                _terminalCache.Record(d.Id, extractedRunId);
            }
            else if (latestStatus is not null)
            {
                // Non-terminal latest status — deployment is still pending.
                pendingCreatedAts.Add(d.CreatedAt);
            }
            // else: zero statuses (latestStatus null) → NOT pending; 1-day floor covers new deployments.
        }

        return (reusedRunIds, allStatuses, pendingCreatedAts);
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
