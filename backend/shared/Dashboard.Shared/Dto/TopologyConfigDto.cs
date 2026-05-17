using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Wire shape for <c>GET /api/config/topology</c> and the body returned by
/// <c>PATCH /api/config/topology</c> (SAD §7 "PATCH /api/config/topology"
/// + "Configuration — Read API topology"):
/// <code>
/// {
///   "correlationAttribute": "version",
///   "perServiceOverrides":  { "service-x": "sha" }
/// }
/// </code>
///
/// <para>The keys are camelCase per the SAD's JSON example (the snake_case
/// global policy is overridden field-by-field with
/// <see cref="JsonPropertyName"/>).</para>
///
/// <para><c>AllowUserOverride</c> was removed in the Phase-1 SAD revision:
/// the SPA is read-only against the API and never invokes <c>PATCH</c>, so
/// the SPA-disable toggle has no remaining purpose. The picker is a pure
/// client-side preference (<c>localStorage</c>) that travels to the server
/// as a <c>correlationAttribute</c> query parameter on read endpoints.</para>
/// </summary>
public sealed record TopologyConfigDto
{
    /// <summary>
    /// Active global default for the correlation-fallback attribute (SAD §5).
    /// One of <c>version</c>, <c>ref</c>, <c>sha</c>, <c>actor</c>, <c>run</c>,
    /// <c>ago</c>. The Read API uses this when a service has no per-service
    /// override AND the request did not pass <c>?correlationAttribute=…</c>.
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string CorrelationAttribute { get; init; } = "version";

    /// <summary>
    /// Active per-service overrides. Highest-precedence source — beats both
    /// the request-scoped <c>?correlationAttribute=</c> query parameter and
    /// the global <see cref="CorrelationAttribute"/> default (SAD §7).
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string> PerServiceOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
}

/// <summary>
/// PATCH body for <c>PATCH /api/config/topology</c> (SAD §7). PATCH
/// semantics: unset fields stay unchanged; <c>null</c> values inside
/// <see cref="PerServiceOverrides"/> remove that service's override.
///
/// <para><see cref="PerServiceOverrides"/> uses nullable values explicitly
/// so deserialisation distinguishes "remove this override" (<c>null</c>)
/// from "leave unchanged" (key omitted). Keys not present in the request
/// are left untouched.</para>
/// </summary>
public sealed record TopologyConfigPatch
{
    /// <summary>
    /// New global default for the correlation-fallback attribute (SAD §5
    /// Topology Derivation). Allowed: <c>version</c>, <c>ref</c>, <c>sha</c>,
    /// <c>actor</c>, <c>run</c>, <c>ago</c>. <c>id</c> is rejected with
    /// <c>400 Bad Request</c>. Omit to leave the current value unchanged.
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string? CorrelationAttribute { get; init; }

    /// <summary>
    /// Per-service overrides for the correlation attribute. PATCH semantics:
    /// each key in the map either sets that service's override (string value)
    /// or removes it (<c>null</c> value). Keys NOT in the map are left
    /// untouched (the dictionary is a delta, not a replacement). Omit the
    /// whole field to leave every existing override in place.
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string?>? PerServiceOverrides { get; init; }
}
