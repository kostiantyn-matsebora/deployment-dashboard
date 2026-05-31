using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Control;

/// <summary>
/// HTTP client for <c>POST /api/control/events</c> (§5.10.4, §5.10.5).
/// <c>X-Api-Key</c> and <c>X-Component-Id</c> are added by the typed-client factory in DI.
/// </summary>
public sealed class ComponentEventClient(
    HttpClient http,
    ILogger<ComponentEventClient> logger) : IComponentEventClient
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <inheritdoc />
    public async Task PostAckAsync(string resetId, CancellationToken ct)
    {
        var body = new ComponentEventBody(
            EventType: "reset-ack",
            State: "paused",
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: new { reset_id = resetId });

        await PostAsync(body, ct);
    }

    /// <inheritdoc />
    public async Task PostRunningAsync(string resetId, CancellationToken ct)
    {
        var body = new ComponentEventBody(
            EventType: "status",
            State: "running",
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: new { reset_id = resetId });

        await PostAsync(body, ct);
    }

    private async Task PostAsync(ComponentEventBody body, CancellationToken ct)
    {
        try
        {
            var response = await http.PostAsJsonAsync(
                "/api/control/events",
                body,
                JsonOptions,
                ct);

            if (!response.IsSuccessStatusCode)
                logger.LogWarning(
                    "[ComponentEvent] POST /api/control/events returned {Status}; event_type={EventType}",
                    (int)response.StatusCode, body.EventType);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Non-fatal per §5.10.4 — ack failure does not block recovery.
            logger.LogWarning(ex,
                "[ComponentEvent] POST /api/control/events failed; event_type={EventType}",
                body.EventType);
        }
    }

    // Separate record so JsonSerializer picks up snake_case names for the payload object.
    private sealed record ComponentEventBody(
        [property: JsonPropertyName("event_type")] string EventType,
        [property: JsonPropertyName("state")] string State,
        [property: JsonPropertyName("occurred_at")] DateTimeOffset OccurredAt,
        [property: JsonPropertyName("payload")] object Payload);
}
