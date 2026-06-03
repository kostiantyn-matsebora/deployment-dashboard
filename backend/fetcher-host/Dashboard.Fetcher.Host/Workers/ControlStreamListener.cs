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
            var connected = false;
            try
            {
                await foreach (var frame in streamClient.StreamAsync(lastEventId, stoppingToken))
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

                    await HandleEventAsync(frame.EventType, frame.Data, stoppingToken);
                }

                // Stream ended cleanly (EOF) — reset backoff on clean completion.
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
            }

            // Exponential backoff before reconnect; reset to minimum after a successful connect.
            try { await Task.Delay(backoff, stoppingToken); }
            catch (OperationCanceledException) { break; }

            if (!connected)
                backoff = backoff < BackoffMax
                    ? TimeSpan.FromSeconds(Math.Min(backoff.TotalSeconds * 2, BackoffMax.TotalSeconds))
                    : BackoffMax;
            else
                backoff = BackoffMin;
        }
    }

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

            default:
                // Unknown event types are no-ops (forward-compat — §5.10.2).
                logger.LogDebug("[ControlStream] Ignoring unknown event type: {EventType}", eventType);
                break;
        }
    }

    private async Task HandleResetInitiatedAsync(string data, CancellationToken ct)
    {
        var ev = DeserializeEvent(data);
        if (ev is null) return;

        // reset_id = the event's own id for reset-initiated (§5.10.4).
        var resetId = ev.Id;

        logger.LogInformation(
            "[ControlStream] reset-initiated received; reset_id={ResetId}; pausing poll loops",
            resetId);

        foreach (var loop in pollLoops)
            loop.Pause();

        // Post ack — non-fatal on failure (§5.10.4). Guard against throws so the
        // stream loop continues and can still process reset-completed.
        try
        {
            await eventClient.PostAckAsync(resetId, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[ControlStream] reset-ack POST failed; remaining paused");
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
