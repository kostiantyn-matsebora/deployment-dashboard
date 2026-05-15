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
    [JsonPropertyName("correlationAttribute")]
    public string CorrelationAttribute { get; init; } = "version";

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
    [JsonPropertyName("correlationAttribute")]
    public string? CorrelationAttribute { get; init; }

    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string?>? PerServiceOverrides { get; init; }
}
