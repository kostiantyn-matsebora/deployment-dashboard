using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Tool-agnostic poll loop. One instance per adapter (§4).
/// Cursor persisted only after all POSTs succeed — guarantees at-least-once delivery (F5).
/// Supports pause / resume for the reset choreography (F17, §5.10.3).
/// </summary>
public sealed class PollLoop(
    ICiCdAdapter adapter,
    IIngestClient ingest,
    IFetcherStateClient state,
    TimeSpan pollInterval,
    ILogger<PollLoop> logger)
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
            // Block here while paused; cancel unblocks the wait.
            if (_isPaused)
            {
                try
                {
                    await _resumeGate.WaitAsync(ct);
                    _resumeGate.Release(); // restore the permit so future iterations pass through
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested)
                {
                    break;
                }
            }

            // Apply cursor override injected by DropCursorAndResume (§5.10.5).
            if (_hasPendingCursorOverride)
            {
                cursor = _pendingCursorOverride;
                _hasPendingCursorOverride = false;
            }

            try
            {
                cursor = await PollOnceAsync(cursor, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "[{Adapter}] poll error; retrying next interval",
                    adapter.AdapterId);
            }

            try
            {
                await Task.Delay(pollInterval, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task<string?> PollOnceAsync(string? cursor, CancellationToken ct)
    {
        var result = await adapter.FetchAsync(cursor, ct);

        foreach (var ev in result.Events)
            await ingest.PostAsync(ev, adapter.AdapterId, ct);

        // Advance cursor only after all POSTs succeed (F5).
        if (result.Events.Count > 0 && result.Cursor != cursor)
        {
            await state.PutAsync(adapter.AdapterId, result.Cursor!, ct);
            cursor = result.Cursor;
        }

        return cursor;
    }
}
