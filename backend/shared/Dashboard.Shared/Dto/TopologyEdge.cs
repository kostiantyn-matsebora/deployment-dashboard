using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One directed edge in a per-service environment graph.
///
/// <para>Shape:</para>
/// <code>
/// { "from": "dev", "to": "qa-1", "source": "explicit" }
/// </code>
///
/// <see cref="Source"/> is the literal string <c>"explicit"</c> (the edge
/// came from a <c>parent_deployments</c> reference at ingest time) or
/// <c>"correlated"</c> (the edge was derived on the read side by matching
/// the active correlation attribute, e.g. same version). Explicit edges
/// win on collisions.
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
    /// Where the edge came from — <c>"explicit"</c> for ingest-time
    /// <c>parent_deployments</c> references, <c>"correlated"</c> for
    /// edges emitted by the correlation fallback pass. Explicit edges win
    /// on <c>(from, to)</c> collisions.
    /// </summary>
    [JsonPropertyName("source")]
    public string Source { get; init; } = SourceExplicit;
}

/// <summary>
/// Per-service topology block embedded in matrix and SSE responses. Always
/// present; <see cref="Edges"/> may be empty.
/// </summary>
public sealed record TopologySnapshot
{
    /// <summary>Directed edges in the per-service environment DAG. May be empty.</summary>
    [JsonPropertyName("edges")]
    public IReadOnlyList<TopologyEdge> Edges { get; init; } = Array.Empty<TopologyEdge>();
}
