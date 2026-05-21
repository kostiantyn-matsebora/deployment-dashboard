using Dashboard.Fetcher.Abstractions;
using Dashboard.Shared.Fetcher;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Periodic worker that drives every registered <see cref="ICiCdAdapter"/>
/// on a drift-resistant cadence (<see cref="PeriodicTimer"/>).
///
/// <para>Per tick, for each <c>(adapter, sourceId)</c>:</para>
/// <list type="number">
///   <item>Consult the per-adapter rate-limit gate (CR-0011) — if the
///   self-imposed cap has been reached AND the upstream reset has not
///   yet passed, skip the fetch (no cursor advance) and only push the
///   most-recently-known usage snapshot.</item>
///   <item>Otherwise, read the cursor via
///   <c>GET /api/fetcher/state/{source-id}</c> (404 → first fetch).</item>
///   <item>Call <c>adapter.FetchPageAsync(sourceId, cursor, pageSize, ct)</c>.</item>
///   <item>For each event in the page, push via
///   <c>POST /api/deployments</c> with both <c>X-Api-Key</c> and
///   <c>X-Progress-Reporter</c> set.</item>
///   <item>If every push succeeded, upsert the new cursor via
///   <c>PUT /api/fetcher/state/{source-id}</c>.</item>
///   <item>If <c>HasMore</c>, drain the next page in the same tick (bounded
///   by a safety multiplier so a runaway adapter cannot monopolise the loop).</item>
///   <item>Always push the latest observed (or carried-from-prior-tick)
///   rate-limit usage snapshot to <c>POST /api/fetcher/usage</c> (CR-0011
///   § 3a — "push runs on every poll tick, even cap-reached ticks").</item>
/// </list>
///
/// <para>NFR-05: the worker keeps no per-source business state in memory
/// (events, cursors, deployment rows). It DOES keep a small per-adapter
/// rate-limit observation cell so the leaky-bucket gate has its "single
/// source of truth" between ticks — this is acceptable per CR-0011 §
/// 3c / ADR-0008 Decision 2: the cell is rebuildable from the very next
/// upstream response, not durable state any other replica relies on.
/// Multiple fetcher replicas would race; deployment is constrained to
/// <c>min/maxReplicas == 1</c> by ADR-0004 Decision 3.</para>
/// </summary>
public sealed class FetcherWorker : BackgroundService
{
    /// <summary>
    /// Maximum number of pages drained in a single tick when an adapter
    /// reports <c>HasMore == true</c>. Protects the host against a
    /// runaway adapter that keeps returning <c>HasMore</c>.
    /// </summary>
    private const int MaxPagesPerTick = 20;

    private readonly FetcherOptions _options;
    private readonly IReadOnlyDictionary<string, ICiCdAdapter> _adaptersById;
    private readonly FetcherStateClient _stateClient;
    private readonly FetcherUsageClient? _usageClient;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<FetcherWorker> _logger;

    /// <summary>
    /// Per-adapter rate-limit state (CR-0011 D2 — cap is per upstream
    /// token = per adapter; reporting is per <c>(adapter, source_id)</c>).
    /// The cell carries the most recent observation from any source under
    /// the adapter and the last reset-at the worker logged "cap reached"
    /// against — used so the INFO log fires at most once per upstream
    /// window (CR-0011 § 3a).
    /// </summary>
    private readonly Dictionary<string, AdapterRateLimitState> _rateLimitStateByAdapter
        = new(StringComparer.Ordinal);

    /// <summary>
    /// Per-(adapter, source-id) most-recent observation — used to carry
    /// forward into the usage push when a tick was skipped or the
    /// adapter returned <c>null</c> for <see cref="FetchPage.RateLimit"/>.
    /// </summary>
    private readonly Dictionary<(string AdapterId, string SourceId), RateLimitObservation> _lastObservationBySource
        = new(new AdapterSourceKeyComparer());

    public FetcherWorker(
        FetcherOptions options,
        IEnumerable<ICiCdAdapter> adapters,
        FetcherStateClient stateClient,
        ILogger<FetcherWorker> logger)
        : this(
              options,
              adapters,
              stateClient,
              // CR-0011 § 3a — always push usage at end of every tick.
              // Auto-build a sibling usage client off the same factory the
              // state client uses so existing callers that supply only the
              // state client get the push for free (no extra DI hop).
              new FetcherUsageClient(stateClient.HttpFactory, Microsoft.Extensions.Logging.Abstractions.NullLogger<FetcherUsageClient>.Instance),
              TimeProvider.System,
              logger)
    {
    }

    /// <summary>
    /// Production overload (DI-resolved): receives the
    /// <see cref="FetcherUsageClient"/> so per-tick usage pushes go out
    /// (CR-0011 § 3a). Tests that don't care about the usage push can
    /// still use the parameter-less overload above; tests that DO care
    /// inject their own client + factory.
    /// </summary>
    public FetcherWorker(
        FetcherOptions options,
        IEnumerable<ICiCdAdapter> adapters,
        FetcherStateClient stateClient,
        FetcherUsageClient usageClient,
        ILogger<FetcherWorker> logger)
        : this(options, adapters, stateClient, usageClient, TimeProvider.System, logger)
    {
    }

    /// <summary>
    /// Test-friendly overload: injects an explicit <see cref="TimeProvider"/>
    /// so unit tests can drive tick scheduling deterministically through a
    /// <c>FakeTimeProvider</c>. The DI registration uses the
    /// usage-client overload above.
    /// </summary>
    public FetcherWorker(
        FetcherOptions options,
        IEnumerable<ICiCdAdapter> adapters,
        FetcherStateClient stateClient,
        FetcherUsageClient? usageClient,
        TimeProvider timeProvider,
        ILogger<FetcherWorker> logger)
    {
        _options = options;
        _adaptersById = adapters.ToDictionary(a => a.AdapterId, StringComparer.Ordinal);
        _stateClient = stateClient;
        _usageClient = usageClient;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Max(5, _options.PollIntervalSeconds));
        _logger.LogInformation(
            "FetcherWorker starting — interval={Interval}s, adapters=[{Adapters}]",
            interval.TotalSeconds,
            string.Join(",", _adaptersById.Keys));

        using var timer = new PeriodicTimer(interval, _timeProvider);

        // Run the first cycle immediately at startup, then on each tick.
        do
        {
            try
            {
                await RunOneCycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Defensive — a cycle-level exception must not kill the
                // worker. Cycle-internal exceptions are already trapped per
                // (adapter, source) below; this is the last-resort net.
                _logger.LogError(ex, "Unhandled exception in fetcher poll cycle; will retry next tick");
            }
        }
        while (await SafelyWaitForNextTickAsync(timer, stoppingToken));
    }

    private static async Task<bool> SafelyWaitForNextTickAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task RunOneCycleAsync(CancellationToken ct)
    {
        foreach (var adapterId in _options.AdapterIds)
        {
            if (!_adaptersById.TryGetValue(adapterId, out var adapter))
            {
                _logger.LogWarning(
                    "FETCHER_ADAPTERS lists '{AdapterId}' but no implementation is registered",
                    adapterId);
                continue;
            }

            var progressReporter = _options.ProgressReporterOverride ?? $"dashboard-fetcher/{adapter.AdapterId}";

            if (!_options.SourceIdsByAdapter.TryGetValue(adapterId, out var sources) || sources.Count == 0)
            {
                _logger.LogDebug("Adapter '{AdapterId}' has no configured source-ids; skipping", adapterId);
                continue;
            }

            foreach (var sourceId in sources)
            {
                if (ct.IsCancellationRequested) return;
                try
                {
                    await PollSourceAsync(adapter, progressReporter, sourceId, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex,
                        "Polling failed for adapter={AdapterId} source-id={SourceId}; will retry next tick",
                        adapter.AdapterId, sourceId);
                }
            }
        }
    }

    private async Task PollSourceAsync(
        ICiCdAdapter adapter, string progressReporter, string sourceId, CancellationToken ct)
    {
        // CR-0011 § 3a leaky-bucket gate — consult the most-recent
        // upstream observation for THIS adapter (cap is per upstream
        // token = per adapter per D2). On cap-reached + reset-not-passed:
        // skip the fetch entirely, no cursor advance, log once per
        // window, then still push the carried-forward usage snapshot so
        // the dashboard sees the cap-reached state.
        if (TryGetAdapterState(adapter.AdapterId, out var adapterState) &&
            adapterState.LastObservation is { } gating &&
            ShouldSkipForCap(adapter.AdapterId, gating))
        {
            // Single INFO log per window — gated on LastLoggedResetAt so
            // restarts inside the same window are also quiet (the cell
            // is recreated as default on restart but the cap-reached
            // state will simply re-trigger the log at most once per
            // window after restart, which is the documented bound).
            LogCapReachedOncePerWindow(adapter.AdapterId, gating);

            // Push the carried snapshot so the dashboard sees "cap reached"
            // on this tick too.
            await PushUsageForCapReachedAsync(adapter, progressReporter, sourceId, gating, ct);
            return;
        }

        var cursor = await _stateClient.GetCursorAsync(progressReporter, sourceId, ct);
        // First fetch: cap pageSize at INITIAL_FETCH_LIMIT; subsequent
        // fetches stay on the same conservative budget (the adapter knows
        // its own natural page size and may clamp lower).
        var pageSize = Math.Clamp(_options.InitialFetchLimit, 1, 500);

        var pagesThisTick = 0;
        RateLimitObservation? latestObservation = null;
        while (pagesThisTick < MaxPagesPerTick && !ct.IsCancellationRequested)
        {
            pagesThisTick++;

            var page = await adapter.FetchPageAsync(sourceId, cursor, pageSize, ct);

            // Capture the rate-limit observation for the post-tick push +
            // for the next tick's cap gate (CR-0011 § 3a + ADR-0008
            // Decision 1 — upstream response IS the source of truth).
            if (page.RateLimit is not null)
            {
                latestObservation = page.RateLimit;
                RememberObservation(adapter.AdapterId, sourceId, page.RateLimit);

                // If the freshly-observed window has already reached the
                // cap, log + stop draining this tick. The same-tick log
                // matches CR-0011 § 3a acceptance criterion (f) — exactly
                // one INFO line per window, NOT per request — and is
                // gated by LogCapReachedOncePerWindow's per-reset dedup
                // so subsequent ticks within the same window stay quiet.
                if (ShouldSkipForCap(adapter.AdapterId, page.RateLimit))
                {
                    LogCapReachedOncePerWindow(adapter.AdapterId, page.RateLimit);

                    // Break out of the page-loop too. We've consumed one
                    // upstream request to learn about the cap; further
                    // page draining within this tick would defeat the
                    // self-imposed governance.
                    break;
                }
            }

            var allPushed = true;
            foreach (var evt in page.Events)
            {
                if (ct.IsCancellationRequested) { allPushed = false; break; }
                try
                {
                    var ok = await _stateClient.PostDeploymentAsync(progressReporter, evt, ct);
                    if (!ok)
                    {
                        allPushed = false;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Push failed for deployment {DeploymentId}; will not advance cursor this tick",
                        evt.DeploymentId);
                    allPushed = false;
                    break;
                }
            }

            // ADR-0004 — only advance the cursor when the full page made it.
            // A partial-page push failure is treated as an idempotent retry on
            // the next tick (the events that did land are caught by the 409
            // path in FetcherStateClient.PostDeploymentAsync).
            if (allPushed)
            {
                if (!string.IsNullOrWhiteSpace(page.NewCursor) && !string.Equals(page.NewCursor, cursor, StringComparison.Ordinal))
                {
                    await _stateClient.PutCursorAsync(progressReporter, sourceId, page.NewCursor, ct);
                    cursor = page.NewCursor;
                }
            }
            else
            {
                _logger.LogInformation(
                    "Partial page push for adapter={AdapterId} source-id={SourceId} — not advancing cursor",
                    adapter.AdapterId, sourceId);
                break;
            }

            if (!page.HasMore || page.Events.Count == 0) break;
        }

        if (pagesThisTick >= MaxPagesPerTick)
        {
            _logger.LogWarning(
                "Hit MaxPagesPerTick={Max} for adapter={AdapterId} source-id={SourceId} — adapter is reporting HasMore continuously",
                MaxPagesPerTick, adapter.AdapterId, sourceId);
        }

        // CR-0011 § 3a: push the usage snapshot at the end of every tick
        // — even ticks that produced zero events. Carry the prior
        // observation forward when the adapter returned null this tick
        // (typically: rate-limit hit / non-success response).
        var observationToPush = latestObservation ?? GetLastObservation(adapter.AdapterId, sourceId);
        if (observationToPush is not null)
        {
            await PushUsageAsync(adapter, progressReporter, sourceId, observationToPush, ct);
        }
    }

    /// <summary>
    /// Cap-reached test (CR-0011 § 3a): we have an observation, the
    /// observed used count met or exceeded the resolved cap, and the
    /// upstream reset has not yet passed. The third condition is the
    /// "reset elapsed → resume" branch from the CR-0011 acceptance
    /// criterion (c).
    /// </summary>
    private bool ShouldSkipForCap(string adapterId, RateLimitObservation observation)
    {
        var cap = RateLimitResolver.Resolve(_options, observation.UpstreamLimit);
        if (cap <= 0) return false; // unable to resolve (no upstream limit yet) → don't gate

        var used = observation.UpstreamLimit - observation.UpstreamRemaining;
        if (used < cap) return false;

        var now = _timeProvider.GetUtcNow().UtcDateTime;
        if (now >= observation.UpstreamResetAt) return false; // window has reset → resume

        return true;
    }

    /// <summary>
    /// Log "self-imposed cap reached" at INFO level at most once per
    /// upstream window (CR-0011 § 3a "log a single INFO line per
    /// window"). The per-window dedup uses
    /// <see cref="AdapterRateLimitState.LastLoggedResetAt"/> — only
    /// advanced when we log, never reset for a still-active window.
    /// </summary>
    private void LogCapReachedOncePerWindow(string adapterId, RateLimitObservation observation)
    {
        var state = GetOrCreateAdapterState(adapterId);
        if (state.LastLoggedResetAt == observation.UpstreamResetAt) return;

        state.LastLoggedResetAt = observation.UpstreamResetAt;
        _logger.LogInformation(
            "Fetcher self-imposed rate-limit cap reached for adapter={AdapterId} — used={Used} cap={Cap} upstream_limit={Limit} reset_at={ResetAt:O}; skipping fetches until reset",
            adapterId,
            observation.UpstreamLimit - observation.UpstreamRemaining,
            RateLimitResolver.Resolve(_options, observation.UpstreamLimit),
            observation.UpstreamLimit,
            observation.UpstreamResetAt);
    }

    private void RememberObservation(string adapterId, string sourceId, RateLimitObservation observation)
    {
        var state = GetOrCreateAdapterState(adapterId);
        state.LastObservation = observation;
        _lastObservationBySource[(adapterId, sourceId)] = observation;
    }

    private RateLimitObservation? GetLastObservation(string adapterId, string sourceId) =>
        _lastObservationBySource.TryGetValue((adapterId, sourceId), out var obs) ? obs : null;

    private AdapterRateLimitState GetOrCreateAdapterState(string adapterId)
    {
        if (!_rateLimitStateByAdapter.TryGetValue(adapterId, out var state))
        {
            state = new AdapterRateLimitState();
            _rateLimitStateByAdapter[adapterId] = state;
        }
        return state;
    }

    private bool TryGetAdapterState(string adapterId, out AdapterRateLimitState state) =>
        _rateLimitStateByAdapter.TryGetValue(adapterId, out state!);

    private async Task PushUsageAsync(
        ICiCdAdapter adapter,
        string progressReporter,
        string sourceId,
        RateLimitObservation observation,
        CancellationToken ct)
    {
        if (_usageClient is null) return;

        var observedAt = observation.ObservedAt.Kind == DateTimeKind.Utc
            ? observation.ObservedAt
            : DateTime.SpecifyKind(observation.ObservedAt, DateTimeKind.Utc);
        var resetAt = observation.UpstreamResetAt.Kind == DateTimeKind.Utc
            ? observation.UpstreamResetAt
            : DateTime.SpecifyKind(observation.UpstreamResetAt, DateTimeKind.Utc);

        var request = new FetcherUsageSnapshotRequest
        {
            AdapterId = adapter.AdapterId,
            SourceId = sourceId,
            UpstreamLimit = observation.UpstreamLimit,
            UpstreamRemaining = observation.UpstreamRemaining,
            UpstreamResetAt = resetAt,
            SelfImposedCap = RateLimitResolver.Resolve(_options, observation.UpstreamLimit),
            // CR-0011 D3: wire field is upstream_used = limit - remaining
            // (NOT a fetcher-side counter that drifts on restart).
            UpstreamUsed = observation.UpstreamLimit - observation.UpstreamRemaining,
            ObservedAt = observedAt,
        };

        try
        {
            await _usageClient.PushUsageAsync(progressReporter, request, ct);
        }
        catch (Exception ex)
        {
            // Defensive — usage push is best-effort; never surface failures
            // up to the per-source loop above (already done inside the
            // client, but be paranoid).
            _logger.LogDebug(ex,
                "FetcherUsageClient.PushUsageAsync threw unexpectedly for adapter={AdapterId} source-id={SourceId}",
                adapter.AdapterId, sourceId);
        }
    }

    private Task PushUsageForCapReachedAsync(
        ICiCdAdapter adapter,
        string progressReporter,
        string sourceId,
        RateLimitObservation observation,
        CancellationToken ct)
        => PushUsageAsync(adapter, progressReporter, sourceId, observation, ct);

    /// <summary>
    /// Per-adapter mutable rate-limit state. Two cells:
    /// <list type="bullet">
    ///   <item><see cref="LastObservation"/> — the most recent observation
    ///   from any source under this adapter (the gate consults this).</item>
    ///   <item><see cref="LastLoggedResetAt"/> — the upstream reset-at of
    ///   the window for which we have already emitted the "cap reached"
    ///   INFO log; dedups the log to once per window.</item>
    /// </list>
    /// </summary>
    private sealed class AdapterRateLimitState
    {
        public RateLimitObservation? LastObservation { get; set; }
        public DateTime? LastLoggedResetAt { get; set; }
    }

    /// <summary>Ordinal case-sensitive tuple equality for the source-grain cache.</summary>
    private sealed class AdapterSourceKeyComparer
        : IEqualityComparer<(string AdapterId, string SourceId)>
    {
        public bool Equals((string AdapterId, string SourceId) x, (string AdapterId, string SourceId) y)
            => string.Equals(x.AdapterId, y.AdapterId, StringComparison.Ordinal)
            && string.Equals(x.SourceId, y.SourceId, StringComparison.Ordinal);

        public int GetHashCode((string AdapterId, string SourceId) obj)
            => HashCode.Combine(
                StringComparer.Ordinal.GetHashCode(obj.AdapterId),
                StringComparer.Ordinal.GetHashCode(obj.SourceId));
    }
}
