using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One service's row in the full matrix response. Carries the per-environment
/// slots and the derived topology graph for that service.
///
/// <para>The top-level matrix response is a dictionary keyed by service name:
/// <c>{ "service-a": ServiceMatrix, "service-b": ServiceMatrix, ... }</c>.</para>
///
/// <para><b>Shape:</b></para>
/// <code>
/// {
///   "envs":     { "dev": MatrixSlot, "qa": MatrixSlot, ... },
///   "topology": { "edges": [ { "from", "to", "source" }, ... ] }
/// }
/// </code>
/// </summary>
public sealed record ServiceMatrix
{
    /// <summary>
    /// Map of <c>environment-name → MatrixSlot</c>. Only environments that
    /// have received at least one deployment for this service appear here;
    /// environments with no history are absent rather than represented by
    /// a null slot.
    /// </summary>
    [JsonPropertyName("envs")]
    public IReadOnlyDictionary<string, MatrixSlot> Envs { get; init; } =
        new Dictionary<string, MatrixSlot>(StringComparer.Ordinal);

    /// <summary>
    /// Per-service environment DAG. Always present; <c>edges</c> may be empty.
    ///
    /// <para><b>Edge sources, in priority order:</b></para>
    /// <list type="number">
    ///   <item>Explicit <c>parent_deployments</c> references at ingest time.</item>
    ///   <item>Correlation-fallback pass (e.g. "same version deployed across envs")
    ///   for services that do not push explicit parents.</item>
    /// </list>
    /// </summary>
    [JsonPropertyName("topology")]
    public TopologySnapshot Topology { get; init; } = new();
}
