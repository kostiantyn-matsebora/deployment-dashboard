using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Contracts;

// D5: unknown fields → 422. The JsonException is caught by the global exception handler.

/// <summary>
/// Request body for <c>POST /api/control/events</c> (OpenAPI <c>ComponentEvent</c>).
/// Component identity is NOT in the body — it is carried by the required
/// <c>X-Component-Id</c> header (D9) and stored as <c>component_id</c> server-side.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ComponentEventIngest
{
    /// <summary>Event category: <c>status</c> | <c>heartbeat</c> | <c>error</c> | … (open).</summary>
    [Required]
    [MinLength(1)]
    [JsonPropertyName("event_type")]
    public required string EventType { get; init; }

    /// <summary>Must be one of <see cref="ComponentState"/> constants. Validated in the endpoint validator.</summary>
    [Required]
    [JsonPropertyName("state")]
    public required string State { get; init; }

    [MaxLength(512)]
    [JsonPropertyName("detail")]
    public string? Detail { get; init; }

    /// <summary>Component-supplied UTC wall-clock at which the event occurred.</summary>
    [Required]
    [JsonPropertyName("occurred_at")]
    public required DateTimeOffset OccurredAt { get; init; }

    /// <summary>Opaque JSON object stored verbatim. Serialised size ≤ 8 KiB → else <c>413</c>.</summary>
    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; init; }
}
