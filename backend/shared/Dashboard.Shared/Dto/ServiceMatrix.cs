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
    [JsonPropertyName("envs")]
    public IReadOnlyDictionary<string, MatrixSlot> Envs { get; init; } =
        new Dictionary<string, MatrixSlot>(StringComparer.Ordinal);

    [JsonPropertyName("topology")]
    public TopologySnapshot Topology { get; init; } = new();
}
