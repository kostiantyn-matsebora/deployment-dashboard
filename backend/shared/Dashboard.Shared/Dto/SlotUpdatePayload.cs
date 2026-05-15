using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Wire shape for the SSE <c>slot-update</c> event's <c>data:</c> payload
/// (SAD §7 "SSE <c>slot-update</c> data payload"):
/// <code>
/// {
///   "service":     "service-a",
///   "environment": "dev",
///   "state":       { "current": { ... }, "lastSuccessful": null | { ... }, "previousFailed": false }
/// }
/// </code>
///
/// <para>The inner <see cref="State"/> mirrors the REST per-slot response
/// from <c>GET /api/deployments</c> exactly.</para>
///
/// <para><strong>Topology is intentionally absent from the SSE wire.</strong>
/// Per SAD §7 "SSE topology semantics — single source of truth" and
/// Decision §10 #8: the SSE event carries the slot update only; the SPA
/// refreshes per-service topology by issuing
/// <c>GET /api/deployments?correlationAttribute=&lt;user-preference&gt;</c>
/// after each event. With per-user picker preferences (Decision §10 #7) a
/// single broadcast payload cannot satisfy every viewer; the matrix GET is
/// the single source of truth for topology.</para>
/// </summary>
public sealed record SlotUpdatePayload
{
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    [JsonPropertyName("state")]
    public MatrixSlot State { get; init; } = default!;
}
