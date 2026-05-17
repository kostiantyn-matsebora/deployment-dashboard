using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Per-service block in the matrix response. Wire shape per SAD §7
/// "Matrix response shape — per service":
/// <code>
/// {
///   "envs":     { "dev": MatrixSlot, "qa": MatrixSlot, ... },
///   "topology": { "edges": [ { "from", "to", "source" }, ... ] }
/// }
/// </code>
///
/// The top-level matrix response is a dictionary
/// <c>{ "service-a": ServiceMatrix, "service-b": ServiceMatrix, ... }</c>.
/// </summary>
public sealed record ServiceMatrix
{
    /// <summary>
    /// Map of <c>environment-name → MatrixSlot</c>. Only slots that have ever
    /// received a deployment for this service appear; environments with no
    /// history are absent rather than represented by a null slot.
    /// </summary>
    [JsonPropertyName("envs")]
    public IReadOnlyDictionary<string, MatrixSlot> Envs { get; init; } =
        new Dictionary<string, MatrixSlot>(StringComparer.Ordinal);

    /// <summary>
    /// Per-service env DAG (SAD §5 "Topology Derivation"). Edges are derived
    /// from explicit <c>parent_deployments</c> first, then from a correlation
    /// fallback pass keyed by the resolved <c>correlationAttribute</c>.
    /// Always present; <c>edges</c> may be empty.
    /// </summary>
    [JsonPropertyName("topology")]
    public TopologySnapshot Topology { get; init; } = new();
}
