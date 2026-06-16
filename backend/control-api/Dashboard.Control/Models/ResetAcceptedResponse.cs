using System.Text.Json.Serialization;

namespace Dashboard.Control.Models;

/// <summary>
/// <c>202</c> response body for <c>POST /api/control/reset</c> (OpenAPI <c>ResetAccepted</c>).
/// </summary>
public sealed record ResetAcceptedResponse(
    [property: JsonPropertyName("correlation_id")] Guid CorrelationId,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("accepted_at")] DateTimeOffset AcceptedAt);
