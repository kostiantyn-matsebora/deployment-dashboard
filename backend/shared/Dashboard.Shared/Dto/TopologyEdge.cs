using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One directed edge in a per-service environment graph.
///
/// <para><b>Shape:</b></para>
/// <code>
/// { "from": "dev", "to": "qa-1", "source": "explicit" }
/// </code>
///
/// <para><b><see cref="Source"/> values:</b></para>
/// <list type="bullet">
///   <item><c>explicit</c> — the edge came from a <c>parent_deployments</c>
///   reference at ingest time.</item>
///   <item><c>correlated</c> — the edge was derived on the read side by
///   matching the active correlation attribute, e.g. same <c>version</c>.</item>
/// </list>
///
/// <para><b>Explicit edges win on collisions.</b></para>
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
    /// Where the edge came from.
    ///
    /// <para><b>Allowed values:</b></para>
    /// <list type="bullet">
    ///   <item><c>explicit</c> — ingest-time <c>parent_deployments</c> reference.</item>
    ///   <item><c>correlated</c> — emitted by the correlation fallback pass.</item>
    /// </list>
    ///
    /// <para><b>Explicit edges win on <c>(from, to)</c> collisions.</b></para>
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
