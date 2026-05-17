using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Active topology / correlation configuration. Returned by
/// <c>GET /api/config/topology</c> and by <c>PATCH /api/config/topology</c>
/// (the PATCH response is the merged, post-update state).
///
/// <para>Shape:</para>
/// <code>
/// {
///   "correlationAttribute": "version",
///   "perServiceOverrides":  { "service-x": "sha" }
/// }
/// </code>
///
/// <para>The dashboard uses this configuration when no explicit
/// <c>parent_deployments</c> were supplied for a deployment, to derive
/// "this version flowed from env A to env B"-style edges from the chosen
/// attribute. Field names on the wire are camelCase.</para>
/// </summary>
public sealed record TopologyConfigDto
{
    /// <summary>
    /// Global default for the correlation-fallback attribute. One of
    /// <c>version</c>, <c>ref</c>, <c>sha</c>, <c>actor</c>, <c>run</c>,
    /// <c>ago</c>. Used when a service has no per-service override AND the
    /// request did not pass an explicit <c>?correlationAttribute=…</c>.
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string CorrelationAttribute { get; init; } = "version";

    /// <summary>
    /// Per-service overrides. Highest-precedence source — wins over both the
    /// request-scoped <c>?correlationAttribute=</c> query parameter and the
    /// global <see cref="CorrelationAttribute"/> default.
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string> PerServiceOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
}

/// <summary>
/// Request body for <c>PATCH /api/config/topology</c>.
///
/// <para>PATCH semantics: any field omitted from the request is left
/// unchanged. Inside <see cref="PerServiceOverrides"/>, a <c>null</c> value
/// removes that service's override; a string value sets / replaces it; a
/// key not present in the map leaves the existing override untouched.</para>
/// </summary>
public sealed record TopologyConfigPatch
{
    /// <summary>
    /// New global default for the correlation-fallback attribute. Allowed
    /// values: <c>version</c>, <c>ref</c>, <c>sha</c>, <c>actor</c>,
    /// <c>run</c>, <c>ago</c>. The value <c>id</c> is rejected with
    /// <c>400 Bad Request</c>. Omit the field to leave the current default
    /// unchanged.
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string? CorrelationAttribute { get; init; }

    /// <summary>
    /// Per-service-override delta. Each entry either sets that service's
    /// override (string value) or removes it (<c>null</c> value). Keys NOT
    /// present in the map are left untouched — the map is a delta, not a
    /// replacement. Omit the whole field to leave every existing override
    /// in place.
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string?>? PerServiceOverrides { get; init; }
}
