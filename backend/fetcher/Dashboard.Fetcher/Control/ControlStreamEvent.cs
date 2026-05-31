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

    /// <summary>Event type: <c>reset-initiated</c> | <c>reset-started</c> | <c>reset-completed</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; init; } = "";

    /// <summary>
    /// Correlates <c>reset-started</c> / <c>reset-completed</c> back to the initiating
    /// <c>reset-initiated</c> event id. <c>null</c> on <c>reset-initiated</c> itself.
    /// </summary>
    [JsonPropertyName("reset_id")]
    public string? ResetId { get; init; }

    [JsonPropertyName("component")]
    public string? Component { get; init; }

    [JsonPropertyName("occurred_at")]
    public DateTimeOffset? OccurredAt { get; init; }
}
