using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One directed edge in a per-service env DAG. Output of the read-side
/// topology builder (SAD §5 "Topology Derivation" → "Output").
///
/// <para>Wire shape per SAD §7 "Matrix response shape — per service":</para>
/// <code>
/// { "from": "dev", "to": "qa-1", "source": "explicit" }
/// </code>
///
/// <see cref="Source"/> is the literal string <c>"explicit"</c> or
/// <c>"correlated"</c> per the merge rules in SAD §5 (explicit wins on
/// <c>(from, to)</c> collisions).
/// </summary>
public sealed record TopologyEdge
{
    public const string SourceExplicit = "explicit";
    public const string SourceCorrelated = "correlated";

    [JsonPropertyName("from")]
    public string From { get; init; } = string.Empty;

    [JsonPropertyName("to")]
    public string To { get; init; } = string.Empty;

    [JsonPropertyName("source")]
    public string Source { get; init; } = SourceExplicit;
}

/// <summary>
/// Per-service topology block embedded in the matrix and SSE responses.
/// Always present (possibly empty) per SAD §7 "Matrix response shape —
/// per service" → field rules.
/// </summary>
public sealed record TopologySnapshot
{
    [JsonPropertyName("edges")]
    public IReadOnlyList<TopologyEdge> Edges { get; init; } = Array.Empty<TopologyEdge>();
}
