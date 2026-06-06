namespace Dashboard.Shared.Entities;

/// <summary>
/// One row in the append-only <c>control_stream_events</c> log (2 h retention).
/// Persists events emitted on the control SSE stream so reconnecting components can
/// replay via <c>Last-Event-ID</c>. Also the data payload of a frame on
/// <c>GET /api/control/stream</c>.
/// </summary>
public sealed class ControlStreamEvent
{
    /// <summary>Server-assigned UUIDv7 — surrogate <b>and</b> SSE resume cursor (D2, D3).</summary>
    public Guid Id { get; set; }

    /// <summary>
    /// Event type: <c>reset-initiated</c> | <c>reset-started</c> | <c>reset-completed</c>.
    /// Open string — unknown values are no-ops for components.
    /// </summary>
    public required string Type { get; set; }

    /// <summary>Target component id, or <c>"*"</c> meaning all components.</summary>
    public required string Component { get; set; }

    /// <summary>
    /// Correlation id: born at <c>reset-initiated</c> (where it equals the event's own id).
    /// <c>reset-started</c> and <c>reset-completed</c> carry the <c>reset-initiated</c> id.
    /// <c>null</c> on <c>reset-initiated</c> itself (populated on downstream frames only).
    /// </summary>
    public Guid? CorrelationId { get; set; }

    /// <summary>Server-assigned UTC timestamp at emit time.</summary>
    public required DateTimeOffset OccurredAt { get; set; }
}
