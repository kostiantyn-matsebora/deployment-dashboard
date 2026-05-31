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
    /// Correlates <c>reset-started</c> / <c>reset-completed</c> back to the id of the
    /// initiating <c>reset-initiated</c> event. <c>null</c> on <c>reset-initiated</c> itself.
    /// </summary>
    public Guid? ResetId { get; set; }

    /// <summary>Server-assigned UTC timestamp at emit time.</summary>
    public required DateTimeOffset OccurredAt { get; set; }
}
