using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Active topology / correlation configuration.
///
/// <para><b>Returned by:</b></para>
/// <list type="bullet">
///   <item><c>GET /api/config/topology</c> — the active state.</item>
///   <item><c>PATCH /api/config/topology</c> — the merged, post-update state.</item>
/// </list>
///
/// <para><b>Shape:</b></para>
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
/// attribute. Field names on the wire are <c>camelCase</c>.</para>
/// </summary>
public sealed record TopologyConfigDto
{
    /// <summary>
    /// Global default for the correlation-fallback attribute.
    ///
    /// <para><b>Allowed values:</b> <c>version</c>, <c>ref</c>, <c>sha</c>,
    /// <c>actor</c>, <c>run</c>, <c>ago</c>.</para>
    ///
    /// <para><b>Used when:</b> a service has no per-service override
    /// <b>and</b> the request did not pass an explicit
    /// <c>?correlationAttribute=...</c>.</para>
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string CorrelationAttribute { get; init; } = "version";

    /// <summary>
    /// Per-service overrides. <b>Highest-precedence source</b> — wins over
    /// both the request-scoped <c>?correlationAttribute=</c> query parameter
    /// and the global <see cref="CorrelationAttribute"/> default.
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string> PerServiceOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
}

/// <summary>
/// Request body for <c>PATCH /api/config/topology</c>.
///
/// <para><b>PATCH semantics:</b></para>
/// <list type="bullet">
///   <item>Any field omitted from the request is left unchanged.</item>
///   <item>Inside <see cref="PerServiceOverrides"/>, a <c>null</c> value
///   removes that service's override.</item>
///   <item>A string value sets / replaces it.</item>
///   <item>A key not present in the map leaves the existing override untouched.</item>
/// </list>
/// </summary>
public sealed record TopologyConfigPatch
{
    /// <summary>
    /// New global default for the correlation-fallback attribute.
    ///
    /// <para><b>Optional.</b> Omit the field to leave the current default unchanged.</para>
    ///
    /// <para><b>Allowed values:</b> <c>version</c>, <c>ref</c>, <c>sha</c>,
    /// <c>actor</c>, <c>run</c>, <c>ago</c>. The value <c>id</c> is rejected
    /// with <c>400 Bad Request</c>.</para>
    /// </summary>
    [JsonPropertyName("correlationAttribute")]
    public string? CorrelationAttribute { get; init; }

    /// <summary>
    /// Per-service-override delta. The map is a <b>delta, not a
    /// replacement</b>.
    ///
    /// <para><b>Optional.</b> Omit the whole field to leave every existing
    /// override in place.</para>
    ///
    /// <para><b>Per-entry semantics:</b></para>
    /// <list type="bullet">
    ///   <item>String value — sets / replaces that service's override.</item>
    ///   <item><c>null</c> value — removes that service's override.</item>
    ///   <item>Key not present in the map — that service's override is left untouched.</item>
    /// </list>
    /// </summary>
    [JsonPropertyName("perServiceOverrides")]
    public IReadOnlyDictionary<string, string?>? PerServiceOverrides { get; init; }
}
