using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Payload of the <c>slot-update</c> Server-Sent Event emitted on
/// <c>GET /api/stream</c> after a deployment is ingested.
///
/// <para><b>Shape:</b></para>
/// <code>
/// {
///   "service":     "service-a",
///   "environment": "dev",
///   "state":       { "current": { ... }, "lastSuccessful": null | { ... }, "previousFailed": false }
/// }
/// </code>
///
/// <para>The inner <see cref="State"/> object mirrors the per-slot block from
/// <c>GET /api/deployments/{service}/{environment}</c> exactly, so SSE
/// consumers can apply the update to their local matrix copy without an
/// extra round-trip.</para>
///
/// <para><b>Topology is intentionally NOT included in the SSE payload.</b>
/// Correlation-attribute preferences are per-user, so a single broadcast
/// payload cannot satisfy every viewer. Clients that need the refreshed
/// per-service topology after a slot update should re-issue
/// <c>GET /api/deployments?correlationAttribute=&lt;preference&gt;</c>.</para>
/// </summary>
public sealed record SlotUpdatePayload
{
    /// <summary>Service whose slot changed.</summary>
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    /// <summary>Environment whose slot changed.</summary>
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    /// <summary>
    /// Updated slot state — identical in shape to the response from
    /// <c>GET /api/deployments/{service}/{environment}</c>.
    /// </summary>
    [JsonPropertyName("state")]
    public MatrixSlot State { get; init; } = default!;
}
