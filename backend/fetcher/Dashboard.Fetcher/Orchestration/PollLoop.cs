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
/// When <paramref name="reportCycleAsync"/> is provided and the cycle produced a non-null
/// snapshot, it is invoked after <see cref="IFetcherReadinessIndicator.RecordSuccess"/>
/// (F18 / §5.11). The delegate is fire-and-swallow: a failure must not interrupt the loop.
/// </summary>
public sealed class PollLoop(
    ICiCdAdapter adapter,
    IIngestClient ingest,
    IFetcherStateClient state,
    TimeSpan pollInterval,
    ILogger<PollLoop> logger,
    IFetcherReadinessIndicator? readiness = null,
    Func<RateLimitSnapshot?>? rateLimitSnapshotFactory = null,
    Func<RateLimitSnapshot, CancellationToken, Task>? reportCycleAsync = null)
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
    /// Pauses the loop after the current in-flight POST completes (§5.10.3).
    /// Idempotent — safe to call while already paused.
    /// </summary>
    public void Pause()
    {
        if (_isPaused) return;
        _isPaused = true;
        _resumeGate.Wait(0); // drain the permit so the next gate wait blocks
        readiness?.SetPausedForReset(true);
        logger.LogInformation("[{Adapter}] poll loop paused for reset", adapter.AdapterId);
    }

    /// <summary>
    /// Drops the in-memory cursor and resumes the loop, triggering the F14 backfill path (§5.10.5).
    /// Idempotent.
    /// </summary>
    public void DropCursorAndResume()
    {
        _pendingCursorOverride = null;
        _hasPendingCursorOverride = true;
        _isPaused = false;
        readiness?.SetPausedForReset(false);
        try { _resumeGate.Release(); } catch (SemaphoreFullException) { /* already at capacity — already running */ }
        logger.LogInformation("[{Adapter}] poll loop resumed with null cursor (backfill will trigger)",
            adapter.AdapterId);
    }

    public async Task RunAsync(CancellationToken ct)
    {
        var cursor = await state.GetAsync(adapter.AdapterId, ct);
        logger.LogInformation("[{Adapter}] poll loop starting; cursor={HasCursor}",
            adapter.AdapterId, cursor is not null);

        while (!ct.IsCancellationRequested)
        {
            if (!await WaitWhilePausedAsync(ct))
                break;

            cursor = ApplyPendingCursorOverride(cursor);

            var (shouldContinue, updatedCursor) = await PollAndReportAsync(cursor, ct);
            cursor = updatedCursor;
            if (!shouldContinue)
                break;

            if (!await DelayIntervalAsync(ct))
                break;
        }
    }

    // Returns false when cancellation has been requested (caller should break).
    private async Task<bool> WaitWhilePausedAsync(CancellationToken ct)
    {
        if (!_isPaused)
            return true;

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

    // Swaps in the cursor injected by DropCursorAndResume (§5.10.5), if any.
    private string? ApplyPendingCursorOverride(string? cursor)
    {
        if (!_hasPendingCursorOverride)
            return cursor;

        _hasPendingCursorOverride = false;
        return _pendingCursorOverride;
    }

    // Runs one poll cycle, records readiness, and posts the rate-limit report (§5.11 / F18).
    // Returns false when cancellation has been requested (caller should break).
    // Returns (shouldContinue, updatedCursor). shouldContinue=false signals the loop to break.
    private async Task<(bool Continue, string? Cursor)> PollAndReportAsync(string? cursor, CancellationToken ct)
    {
        try
        {
            cursor = await PollOnceAsync(cursor, ct);
            var snapshot = rateLimitSnapshotFactory?.Invoke();
            readiness?.RecordSuccess(snapshot);
            await TryReportRateLimitAsync(snapshot, ct);
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
            readiness?.RecordAuthFailed(ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "[{Adapter}] poll error; retrying next interval",
                adapter.AdapterId);
            readiness?.RecordError(ex.Message);
        }

        return (true, cursor);
    }

    // Posts per-cycle rate-limit snapshot; non-fatal on failure (§5.11 / F18).
    private async Task TryReportRateLimitAsync(RateLimitSnapshot? snapshot, CancellationToken ct)
    {
        if (reportCycleAsync is null || snapshot is null)
            return;

        try
        {
            await reportCycleAsync(snapshot, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex,
                "[{Adapter}] per-cycle rate-limit report failed (non-fatal)",
                adapter.AdapterId);
        }
    }

    // Waits one poll interval. Returns false when cancellation fires (caller should break).
    private async Task<bool> DelayIntervalAsync(CancellationToken ct)
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
        }

        return cursor;
    }
}
