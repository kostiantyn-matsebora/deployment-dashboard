using System.Text.Json.Serialization;

namespace Dashboard.Fetcher.Control;

/// <summary>
/// SSE data payload received from <c>GET /api/control/stream</c>.
/// Unknown fields are ignored — forward-compat per §5.10.2 and api-guidelines §11.
/// </summary>
public sealed record ControlStreamEvent
{
    /// <summary>UUIDv7 event id — used as <c>Last-Event-ID</c> on reconnect.</summary>
    [JsonPropertyName("id")]
    public string Id { get; init; } = "";

    /// <summary>
    /// Event type: <c>reset-initiated</c> | <c>reset-started</c> | <c>reset-completed</c> |
    /// <c>recover-initiated</c> | <c>recover-started</c> | <c>recover-completed</c>.
    /// </summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = "";

    /// <summary>
    /// Correlates <c>*-started</c> / <c>*-completed</c> back to the initiating
    /// <c>*-initiated</c> event id. <c>null</c> on the <c>*-initiated</c> event itself.
    /// </summary>
    [JsonPropertyName("reset_id")]
    public string? ResetId { get; init; }

    [JsonPropertyName("component")]
    public string? Component { get; init; }

    [JsonPropertyName("occurred_at")]
    public DateTimeOffset? OccurredAt { get; init; }

    /// <summary>
    /// Opaque per-event data; <c>null</c> when the event carries none (mirrors
    /// <c>ControlStreamEvent.payload</c> in openapi.yaml). Carries the resolved rewind point
    /// on <c>recover-*</c> frames (<c>{"since":"2026-07-14T00:00:00Z"}</c>); absent/null on
    /// the reset choreography frames.
    /// </summary>
    [JsonPropertyName("payload")]
    public ControlStreamEventPayload? Payload { get; init; }
}

/// <summary>
/// Typed view of the <c>recover-*</c> payload shape (<c>{"since": "..."}</c>) — the only
/// field the fetcher currently needs from <see cref="ControlStreamEvent.Payload"/>. Unknown
/// properties are ignored (forward-compat).
/// </summary>
public sealed record ControlStreamEventPayload
{
    [JsonPropertyName("since")]
    public DateTimeOffset? Since { get; init; }
}
