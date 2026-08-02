using System.Net;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Tool-agnostic poll loop. One instance per adapter (§4).
/// Cursor persisted only after all POSTs succeed — guarantees at-least-once delivery (F5).
/// Supports pause / resume for the reset choreography (F17, §5.10.3).
/// Updates <see cref="IFetcherReadinessIndicator"/> after every cycle when provided.
/// When <paramref name="reportCycleAsync"/> is provided and a chunk produced a non-null
/// snapshot, it is invoked once per chunk inside <see cref="PollOnceAsync"/>
/// (F18 / §5.11) — before <see cref="IFetcherReadinessIndicator.RecordSuccess"/>, which
/// updates readiness once at the end of the cycle after all chunks complete.
/// The delegate is fire-and-swallow: a failure must not interrupt the loop.
/// </summary>
public sealed class PollLoop(
    ICiCdAdapter adapter,
    IIngestClient ingest,
    IFetcherStateClient state,
    TimeSpan pollInterval,
    ILogger<PollLoop> logger,
    PollLoopReporting? reporting = null)
{
    // Guards the pause state. Permit is drained when paused so the loop waits on WaitAsync.
    private readonly SemaphoreSlim _resumeGate = new(1, 1);
    private volatile bool _isPaused;

    // Allows the reset handler to inject a null cursor on reset-completed (§5.10.5).
    private volatile bool _hasPendingCursorOverride;
    private string? _pendingCursorOverride;

    /// <summary>Whether the loop is currently paused (for observability / testing).</summary>
    public bool IsPaused => _isPaused;

    /// <summary>
    /// This loop's adapter — exposed so the control-plane listener can build a recover
    /// rewind cursor via <see cref="ICiCdAdapter.RewindTo"/> before calling
    /// <see cref="RewindAndResume"/> (§5.10.6). The loop still owns cache-clearing /
    /// cursor-injection; this only lets the caller reach the adapter that produces the cursor.
    /// </summary>
    public ICiCdAdapter Adapter => adapter;

    /// <summary>
    /// Pauses the loop after the current in-flight POST completes (§5.10.3).
    /// Idempotent — safe to call while already paused.
    /// </summary>
    public void Pause()
    {
        if (_isPaused) return;
        _isPaused = true;
        _resumeGate.Wait(0); // drain the permit so the next gate wait blocks
        reporting?.Readiness?.SetPausedForReset(true);
        logger.LogInformation("[{Adapter}] poll loop paused for reset", adapter.AdapterId);
    }

    /// <summary>
    /// Drops the in-memory cursor and resumes the loop, triggering the F14 backfill path (§5.10.5).
    /// Idempotent.
    /// </summary>
    public void DropCursorAndResume()
    {
        // Reset saga (§5.10.5): bring the fetcher to a genuine clean slate — clear the
        // adapter's dedup caches AND drop the cursor — so the next cycle backfills from
        // scratch rather than reverting to incremental with warm caches.
        adapter.ResetState();
        _pendingCursorOverride = null;
        _hasPendingCursorOverride = true;
        _isPaused = false;
        reporting?.Readiness?.SetPausedForReset(false);
        try { _resumeGate.Release(); } catch (SemaphoreFullException) { /* already at capacity — already running */ }
        logger.LogInformation(
            "[{Adapter}] poll loop resumed with clean slate (caches cleared, cursor dropped — backfill will trigger)",
            adapter.AdapterId);
    }

    /// <summary>
    /// Recover saga (§5.10.6): resumes the loop with a caller-supplied, already-rewound
    /// NON-null cursor (built via <see cref="ICiCdAdapter.RewindTo"/>) instead of dropping it —
    /// the opposite of <see cref="DropCursorAndResume"/>: recovery stays on the incremental
    /// poll branch and never triggers backfill. Also clears the adapter's windowed dedup
    /// caches so a warm conditional-request hit doesn't reuse the narrow pre-rewind window.
    /// Idempotent.
    /// </summary>
    public void RewindAndResume(string cursor)
    {
        ArgumentException.ThrowIfNullOrEmpty(cursor);

        adapter.ResetState();
        _pendingCursorOverride = cursor;
        _hasPendingCursorOverride = true;
        _isPaused = false;
        reporting?.Readiness?.SetPausedForReset(false);
        try { _resumeGate.Release(); } catch (SemaphoreFullException) { /* already at capacity — already running */ }
        logger.LogInformation(
            "[{Adapter}] poll loop resumed via recover rewind (caches cleared, incremental cursor injected)",
            adapter.AdapterId);
    }

    public async Task RunAsync(CancellationToken ct)
    {
        var (cancelled, cursor) = await FetchInitialCursorAsync(ct);
        if (cancelled) return; // ct cancelled before the initial fetch ever succeeded — clean exit, no fault.

        logger.LogInformation("[{Adapter}] poll loop starting; cursor={HasCursor}",
            adapter.AdapterId, cursor is not null);

        while (!ct.IsCancellationRequested)
        {
            if (!await WaitWhilePausedAsync(ct)) break;

            cursor = ApplyPendingCursorOverride(cursor);

            var (cont, next) = await RunOneCycleAsync(cursor, ct);
            cursor = next;
            if (!cont) break;

            if (!await WaitIntervalAsync(ct)) break;
        }
    }

    // Retries the startup cursor fetch until it succeeds or ct is cancelled. This call happens
    // once, before the while loop, with no surrounding try/catch there — left unguarded, a
    // transient failure here (observed in prod: CNI egress race during pod startup) faults
    // RunAsync's task permanently. FetcherWorker awaits every PollLoop alongside the
    // never-ending DiscoveryLoop via Task.WhenAll, so that fault is never surfaced: /health
    // stays 200 while this adapter silently stops polling forever. Returns (true, null) only
    // when ct is cancelled while still retrying — a clean, un-faulted exit.
    private async Task<(bool Cancelled, string? Cursor)> FetchInitialCursorAsync(CancellationToken ct)
    {
        while (true)
        {
            try
            {
                return (false, await state.GetAsync(adapter.AdapterId, ct));
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                return (true, null);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[{Adapter}] initial cursor fetch failed; retrying in {Interval}",
                    adapter.AdapterId, pollInterval);
                if (!await WaitIntervalAsync(ct)) return (true, null);
            }
        }
    }

    // Executes one poll cycle. Returns false when cancellation signals a clean exit.
    // Executes one poll cycle. Returns (false, cursor) when cancellation signals a clean exit,
    // (true, newCursor) on success, or (true, cursor) on a retriable error.
    private async Task<(bool Continue, string? Cursor)> RunOneCycleAsync(string? cursor, CancellationToken ct)
    {
        try
        {
            var next = await PollOnceAsync(cursor, ct);
            await RecordSuccessAsync();
            return (true, next);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return (false, cursor);
        }
        catch (HttpRequestException ex) when (
            ex.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
        {
            logger.LogError(ex, "[{Adapter}] poll error (auth failed); retrying next interval",
                adapter.AdapterId);
            reporting?.Readiness?.RecordAuthFailed(ex.Message);
            return (true, cursor);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[{Adapter}] poll error; retrying next interval",
                adapter.AdapterId);
            reporting?.Readiness?.RecordError(ex.Message);
            return (true, cursor);
        }
    }

    // Records a successful poll cycle: updates readiness indicator.
    // The per-cycle rate-limit report (F18 / §5.11) is now emitted per-chunk inside
    // PollOnceAsync so backfill cycles report after each (repo×env) chunk, not only once
    // at the end of the entire enumeration.
    private Task RecordSuccessAsync()
    {
        var snapshot = reporting?.RateLimitSnapshotFactory?.Invoke();
        reporting?.Readiness?.RecordSuccess(snapshot);
        return Task.CompletedTask;
    }

    // F18 / §5.11 — per-chunk rate-limit report, gated on snapshot presence.
    // Extracted so PollOnceAsync can fire it after every chunk (1 chunk for normal poll,
    // N chunks for backfill).
    private async Task ReportSnapshotIfPresentAsync(CancellationToken ct)
    {
        var snapshot = reporting?.RateLimitSnapshotFactory?.Invoke();
        if (reporting?.ReportCycleAsync is not null && snapshot is not null)
            await TryReportCycleAsync(snapshot, ct);
    }

    // Block here while paused; cancel unblocks the wait. Returns false when cancelled.
    private async Task<bool> WaitWhilePausedAsync(CancellationToken ct)
    {
        if (!_isPaused) return true;
        try
        {
            await _resumeGate.WaitAsync(ct);
            _resumeGate.Release(); // restore the permit so future iterations pass through
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return false;
        }
    }

    // Apply cursor override injected by DropCursorAndResume (§5.10.5).
    private string? ApplyPendingCursorOverride(string? cursor)
    {
        if (!_hasPendingCursorOverride) return cursor;
        _hasPendingCursorOverride = false;
        return _pendingCursorOverride;
    }

    // Fire-and-swallow per-cycle rate-limit report (F18 / §5.11).
    // A failure must not interrupt the loop.
    private async Task TryReportCycleAsync(RateLimitSnapshot snapshot, CancellationToken ct)
    {
        try
        {
            await reporting!.ReportCycleAsync!(snapshot, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex,
                "[{Adapter}] per-cycle rate-limit report failed (non-fatal)",
                adapter.AdapterId);
        }
    }

    // Wait for the configured poll interval. Returns false when cancelled.
    private async Task<bool> WaitIntervalAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(pollInterval, ct).ConfigureAwait(false);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task<string?> PollOnceAsync(string? cursor, CancellationToken ct)
    {
        // Iterate chunks; post each chunk's events, then persist the cursor when it changes.
        // Persist even on 0-event chunks (backfill completion markers carry no events but
        // advance the cursor — §5.8, chunk granularity rule 3).
        // At-least-once (F5): a throw mid-chunk leaves the cursor at the last completed
        // chunk; the next poll re-delivers the failed chunk (duplicates acceptable).
        await foreach (var chunk in adapter.FetchAsync(cursor, ct))
        {
            foreach (var ev in chunk.Events)
                await ingest.PostAsync(ev, adapter.AdapterId, ct);

            if (chunk.Cursor != cursor)
            {
                await state.PutAsync(adapter.AdapterId, chunk.Cursor!, ct);
                cursor = chunk.Cursor;
            }

            // F18 / §5.11 — emit after each chunk so backfill cycles get per-(repo×env)
            // quota visibility rather than a single report at the end of the enumeration.
            await ReportSnapshotIfPresentAsync(ct);
        }

        return cursor;
    }
}

/// <summary>Groups the three optional observability collaborators for <see cref="PollLoop"/>
/// so its constructor stays within S107 (≤7 parameters).</summary>
public sealed record PollLoopReporting(
    IFetcherReadinessIndicator? Readiness,
    Func<RateLimitSnapshot?>? RateLimitSnapshotFactory,
    Func<RateLimitSnapshot, CancellationToken, Task>? ReportCycleAsync);
