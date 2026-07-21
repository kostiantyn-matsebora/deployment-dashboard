using System.Text.Json.Serialization;

namespace Dashboard.Control.Models;

/// <summary>
/// <c>202</c> response body for <c>POST /api/control/recover</c> (OpenAPI <c>RecoverAccepted</c>).
/// </summary>
public sealed record RecoverAcceptedResponse(
    [property: JsonPropertyName("correlation_id")] Guid CorrelationId,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("since")] DateTimeOffset Since,
    [property: JsonPropertyName("accepted_at")] DateTimeOffset AcceptedAt);
