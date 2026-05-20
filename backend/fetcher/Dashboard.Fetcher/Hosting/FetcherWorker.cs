using Dashboard.Fetcher.Abstractions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Periodic worker that drives every registered <see cref="ICiCdAdapter"/>
/// on a drift-resistant cadence (<see cref="PeriodicTimer"/>).
///
/// <para>Per tick, for each <c>(adapter, sourceId)</c>:</para>
/// <list type="number">
///   <item>Read the cursor via <c>GET /api/fetcher/state/{source-id}</c>
///   (404 → first fetch).</item>
///   <item>Call <c>adapter.FetchPageAsync(sourceId, cursor, pageSize, ct)</c>.</item>
///   <item>For each event in the page, push via
///   <c>POST /api/deployments</c> with both <c>X-Api-Key</c> and
///   <c>X-Progress-Reporter</c> set.</item>
///   <item>If every push succeeded, upsert the new cursor via
///   <c>PUT /api/fetcher/state/{source-id}</c>.</item>
///   <item>If <c>HasMore</c>, drain the next page in the same tick (bounded
///   by a safety multiplier so a runaway adapter cannot monopolise the loop).</item>
/// </list>
///
/// <para>NFR-05: the worker keeps no per-source state in memory; everything
/// it needs is read from / written to the backend each tick. Multiple
/// fetcher replicas would race; deployment is constrained to
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
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<FetcherWorker> _logger;

    public FetcherWorker(
        FetcherOptions options,
        IEnumerable<ICiCdAdapter> adapters,
        FetcherStateClient stateClient,
        ILogger<FetcherWorker> logger)
        : this(options, adapters, stateClient, TimeProvider.System, logger)
    {
    }

    /// <summary>
    /// Test-friendly overload: injects an explicit <see cref="TimeProvider"/>
    /// so unit tests can drive tick scheduling deterministically through a
    /// <c>FakeTimeProvider</c>. The DI registration uses the parameter-less
    /// overload above (defaulting to <see cref="TimeProvider.System"/>).
    /// </summary>
    public FetcherWorker(
        FetcherOptions options,
        IEnumerable<ICiCdAdapter> adapters,
        FetcherStateClient stateClient,
        TimeProvider timeProvider,
        ILogger<FetcherWorker> logger)
    {
        _options = options;
        _adaptersById = adapters.ToDictionary(a => a.AdapterId, StringComparer.Ordinal);
        _stateClient = stateClient;
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
        var cursor = await _stateClient.GetCursorAsync(progressReporter, sourceId, ct);
        // First fetch: cap pageSize at INITIAL_FETCH_LIMIT; subsequent
        // fetches stay on the same conservative budget (the adapter knows
        // its own natural page size and may clamp lower).
        var pageSize = Math.Clamp(_options.InitialFetchLimit, 1, 500);

        var pagesThisTick = 0;
        while (pagesThisTick < MaxPagesPerTick && !ct.IsCancellationRequested)
        {
            pagesThisTick++;

            var page = await adapter.FetchPageAsync(sourceId, cursor, pageSize, ct);

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
    }
}
