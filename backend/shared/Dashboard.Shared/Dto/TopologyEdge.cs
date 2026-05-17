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
    /// <summary>Edge derived from an explicit <c>parent_deployments</c> reference.</summary>
    public const string SourceExplicit = "explicit";

    /// <summary>Edge derived from the correlation-attribute fallback pass.</summary>
    public const string SourceCorrelated = "correlated";

    /// <summary>Parent environment in the DAG.</summary>
    [JsonPropertyName("from")]
    public string From { get; init; } = string.Empty;

    /// <summary>Child environment in the DAG.</summary>
    [JsonPropertyName("to")]
    public string To { get; init; } = string.Empty;

    /// <summary>
    /// Origin of this edge — <c>"explicit"</c> when materialised from a
    /// <c>parent_deployments</c> reference, <c>"correlated"</c> when emitted
    /// by the correlation fallback pass. Explicit wins on <c>(from, to)</c>
    /// collisions (SAD §5).
    /// </summary>
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
    /// <summary>Directed edges in the per-service env DAG. Possibly empty.</summary>
    [JsonPropertyName("edges")]
    public IReadOnlyList<TopologyEdge> Edges { get; init; } = Array.Empty<TopologyEdge>();
}
