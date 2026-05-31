namespace Dashboard.Shared.Entities;

/// <summary>
/// Single-row external state for the reset choreography state machine (D12).
/// Always PK = 1; upserted in place, never appended or purged.
/// </summary>
public sealed class ResetCycle
{
    /// <summary>Fixed PK value — enforces single-row constraint.</summary>
    public short Id { get; set; } = 1;

    /// <summary>Current phase: <c>idle</c> | <c>draining</c> | <c>resetting</c>.</summary>
    public required string State { get; set; }

    /// <summary>Id of the current cycle's <c>reset-initiated</c> event; <c>null</c> when <c>idle</c>.</summary>
    public Guid? ResetId { get; set; }

    /// <summary>Snapshot of <c>ExpectedComponents</c> at cycle start.</summary>
    public string[]? ExpectedComponents { get; set; }

    /// <summary>Component ids that have posted <c>reset-ack</c> for the active <c>ResetId</c>.</summary>
    public string[]? AcksReceived { get; set; }

    /// <summary>Server timestamp when the cycle entered <c>draining</c>.</summary>
    public DateTimeOffset? StartedAt { get; set; }

    /// <summary>
    /// <c>StartedAt + AckTimeoutSeconds</c>; also the upper bound for the GateMaxTtl safety abort.
    /// </summary>
    public DateTimeOffset? DeadlineAt { get; set; }
}
