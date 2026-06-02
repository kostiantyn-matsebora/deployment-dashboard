namespace Dashboard.Shared.Entities;

/// <summary>
/// One row in the append-only <c>component_events</c> log (2 h retention).
/// Stores operational events posted by components via <c>POST /api/control/events</c>.
/// Streamed on <c>GET /api/control/events/stream</c> (contract schema <c>ComponentEventRecord</c>).
/// </summary>
public sealed class ComponentEvent
{
    /// <summary>Server-assigned UUIDv7 — surrogate and sort key.</summary>
    public Guid Id { get; set; }

    /// <summary>From the <c>X-Component-Id</c> header (D9); stored verbatim. Pattern <c>^[a-z0-9][a-z0-9.-]{0,127}$</c>.</summary>
    public required string ComponentId { get; set; }

    /// <summary>Open event category: <c>status</c> | <c>heartbeat</c> | <c>error</c> | … .</summary>
    public required string EventType { get; set; }

    /// <summary>One of <see cref="Contracts.ComponentState"/> constants.</summary>
    public required string State { get; set; }

    /// <summary>Human-readable activity/error description. Max 512 chars.</summary>
    public string? Detail { get; set; }

    /// <summary>Component-supplied UTC wall-clock at which the event occurred (mirrors <c>happened_at</c>).</summary>
    public required DateTimeOffset OccurredAt { get; set; }

    /// <summary>Server-assigned insert time.</summary>
    public required DateTimeOffset ReceivedAt { get; set; }

    /// <summary>Opaque JSON object stored verbatim (jsonb on Postgres). Serialised size ≤ 8 KiB.</summary>
    public string? Payload { get; set; }
}
