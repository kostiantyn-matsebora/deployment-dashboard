using System.Text.Json;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Host.Workers;

/// <summary>
/// Long-lived <see cref="BackgroundService"/> that holds an open <c>GET /api/control/stream</c>
/// connection and reacts to reset choreography events (F17, §5.10).
/// Runs concurrently with <see cref="FetcherWorker"/>; signals it via <see cref="PollLoop"/>.
/// </summary>
public sealed class ControlStreamListener(
    IControlStreamClient streamClient,
    IComponentEventClient eventClient,
    IReadOnlyList<PollLoop> pollLoops,
    ILogger<ControlStreamListener> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    // Exponential backoff: 1 s, 2 s, 4 s, … capped at 30 s (§5.10.2 / F4).
    private static readonly TimeSpan BackoffMin = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan BackoffMax = TimeSpan.FromSeconds(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        string? lastEventId = null;
        var backoff = BackoffMin;

        while (!stoppingToken.IsCancellationRequested)
        {
            bool connected;
            try
            {
                (connected, lastEventId) = await ConsumeStreamAsync(lastEventId, stoppingToken);
                if (connected)
                    backoff = BackoffMin;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "[ControlStream] Stream disconnected; reconnecting with Last-Event-ID={LastId} in {Backoff}s",
                    lastEventId, (int)backoff.TotalSeconds);
                connected = false;
            }

            if (!await DelayBackoffAsync(backoff, stoppingToken)) break;
            backoff = NextBackoff(connected, backoff);
        }
    }

    // Consumes one stream connection until EOF. Returns true when at least one frame was received
    // (used to decide whether to reset backoff). Throws on cancellation or stream error.
    // Consumes one stream connection until EOF. Returns (connected, updatedLastEventId).
    // connected=true when at least one frame was received (used to decide whether to reset backoff).
    // Throws on cancellation or stream error.
    private async Task<(bool Connected, string? LastEventId)> ConsumeStreamAsync(
        string? lastEventId, CancellationToken ct)
    {
        var connected = false;
        await foreach (var frame in streamClient.StreamAsync(lastEventId, ct))
        {
            connected = true;

            if (frame.IsPing)
            {
                // Heartbeat — no action, just keeps read-idle timer reset (§5.10.2).
                continue;
            }

            // Track last-seen id for reconnect (§5.10.2).
            if (!string.IsNullOrEmpty(frame.Id))
                lastEventId = frame.Id;

            if (frame.EventType is null || frame.Data is null)
                continue;

            await HandleEventAsync(frame.EventType, frame.Data, ct);
        }

        return (connected, lastEventId);
    }

    // Waits for the current backoff duration. Returns false when cancelled.
    private static async Task<bool> DelayBackoffAsync(TimeSpan backoff, CancellationToken ct)
    {
        try { await Task.Delay(backoff, ct); return true; }
        catch (OperationCanceledException) { return false; }
    }

    // Returns the next backoff value: minimum after a clean connect, doubled (capped) otherwise.
    private static TimeSpan NextBackoff(bool connected, TimeSpan current) =>
        connected ? BackoffMin
            : TimeSpan.FromSeconds(Math.Min(current.TotalSeconds * 2, BackoffMax.TotalSeconds));

    private async Task HandleEventAsync(string eventType, string data, CancellationToken ct)
    {
        switch (eventType)
        {
            case "reset-initiated":
                await HandleResetInitiatedAsync(data, ct);
                break;

            case "reset-started":
                // No-op — fetcher already paused on reset-initiated (§5.10.3).
                logger.LogInformation("[ControlStream] reset-started received; holding (already paused)");
                break;

            case "reset-completed":
                await HandleResetCompletedAsync(data, ct);
                break;

            case "recover-initiated":
                await HandleRecoverInitiatedAsync(data, ct);
                break;

            case "recover-started":
                // No-op — fetcher already paused on recover-initiated (§5.10.3/§5.10.6).
                logger.LogInformation("[ControlStream] recover-started received; holding (already paused)");
                break;

            case "recover-completed":
                await HandleRecoverCompletedAsync(data, ct);
                break;

            default:
                // Unknown event types are no-ops (forward-compat — §5.10.2).
                logger.LogDebug("[ControlStream] Ignoring unknown event type: {EventType}", eventType);
                break;
        }
    }

    private Task HandleResetInitiatedAsync(string data, CancellationToken ct) =>
        HandlePauseAndAckAsync(data, "reset", ct);

    private Task HandleRecoverInitiatedAsync(string data, CancellationToken ct) =>
        HandlePauseAndAckAsync(data, "recover", ct);

    // Shared pause+ack handling for both *-initiated events — reset and recover choreograph
    // this step identically (§5.10.3/§5.10.6): pause every loop, then ack (non-fatal on
    // failure) so the orchestrator's drain phase can proceed either way.
    private async Task HandlePauseAndAckAsync(string data, string operation, CancellationToken ct)
    {
        var ev = DeserializeEvent(data);
        if (ev is null) return;

        // The correlation id = the event's own id for an *-initiated event (§5.10.4).
        var correlationId = ev.Id;

        logger.LogInformation(
            "[ControlStream] {Operation}-initiated received; correlation_id={CorrelationId}; pausing poll loops",
            operation, correlationId);

        foreach (var loop in pollLoops)
            loop.Pause();

        // Post ack — non-fatal on failure (§5.10.4). Guard against throws so the
        // stream loop continues and can still process the matching *-completed event.
        try
        {
            await eventClient.PostAckAsync(correlationId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[ControlStream] {Operation}-ack POST failed; remaining paused", operation);
        }
    }

    private async Task HandleResetCompletedAsync(string data, CancellationToken ct)
    {
        var ev = DeserializeEvent(data);
        if (ev is null) return;

        var resetId = ev.ResetId ?? ev.Id;

        logger.LogInformation(
            "[ControlStream] reset-completed received; reset_id={ResetId}; resuming poll loops",
            resetId);

        // Drop cursor and resume — the null cursor triggers the existing F14 backfill path.
        foreach (var loop in pollLoops)
            loop.DropCursorAndResume();

        // Report running after resuming (§5.10.5).
        await eventClient.PostRunningAsync(resetId, ct);
    }

    // Recover saga (§5.10.6): NOT the reset path. Rewinds every loop's adapter to a
    // NON-null, NON-empty cursor (every repo's since = the resolved rewind point, no
    // backfill markers) so FetchAsync stays on the incremental poll branch — recovery must
    // never trigger backfill. The resolved `since` travels in the event payload, not in the
    // event id/correlation id.
    private async Task HandleRecoverCompletedAsync(string data, CancellationToken ct)
    {
        var ev = DeserializeEvent(data);
        if (ev is null) return;

        var correlationId = ev.ResetId ?? ev.Id;
        var since = ev.Payload?.Since;

        if (since is null)
        {
            logger.LogWarning(
                "[ControlStream] recover-completed received without a resolved 'since' in " +
                "payload; correlation_id={CorrelationId}; ignoring (loops remain paused)",
                correlationId);
            return;
        }

        logger.LogInformation(
            "[ControlStream] recover-completed received; correlation_id={CorrelationId}; " +
            "since={Since}; rewinding poll loops",
            correlationId, since);

        foreach (var loop in pollLoops)
        {
            var rewoundCursor = loop.Adapter.RewindTo(since.Value);
            loop.RewindAndResume(rewoundCursor);
        }

        // Report running after resuming (§5.10.6, mirrors reset-completed's §5.10.5 ack).
        await eventClient.PostRunningAsync(correlationId, ct);
    }

    private ControlStreamEvent? DeserializeEvent(string data)
    {
        try
        {
            return JsonSerializer.Deserialize<ControlStreamEvent>(data, JsonOptions);
        }
        catch (JsonException ex)
        {
            logger.LogWarning(ex, "[ControlStream] Failed to deserialize event data");
            return null;
        }
    }
}
