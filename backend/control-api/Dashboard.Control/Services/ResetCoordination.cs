using Dashboard.Shared.Entities;

namespace Dashboard.Control.Services;

/// <summary>
/// Shared constants and helpers for reset-cycle coordination across the active driver
/// (<see cref="ResetOrchestrator"/>) and the crash-recovery <see cref="ResetReconciler"/>.
/// </summary>
internal static class ResetCoordination
{
    /// <summary>
    /// Fixed Postgres advisory-lock key that elects the single reset driver across
    /// stateless API instances (D12). Both the orchestrator and the reconciler contend
    /// on this one key, so they can never drive a cycle concurrently.
    /// </summary>
    public const long AdvisoryLockKey = 7_654_321L;

    // ── Connection string ─────────────────────────────────────────────────────

    /// <summary>Connection-string name used in <c>appsettings.json</c> / env (D12).</summary>
    internal const string PostgresConnectionName = "Postgres";

    // ── Control-stream event types ────────────────────────────────────────────

    /// <summary>Emitted when a reset cycle begins; triggers ack-wait on components.</summary>
    internal const string EventResetInitiated = "reset-initiated";

    /// <summary>Emitted when all expected acks are received (or timed out); ingest gate ON.</summary>
    internal const string EventResetStarted = "reset-started";

    /// <summary>Emitted when data is cleared and the gate is released; components resume.</summary>
    internal const string EventResetCompleted = "reset-completed";

    // ── Control-stream component wildcard ─────────────────────────────────────

    /// <summary>Wildcard value for the <c>component</c> field — delivered to all subscribers.</summary>
    internal const string ComponentWildcard = "*";

    // ── Factory ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a <see cref="ControlStreamEvent"/> with a new UUIDv7 id, the given type,
    /// wildcard component, and the supplied <paramref name="correlationId"/>.
    /// </summary>
    internal static ControlStreamEvent BuildControlEvent(string type, Guid correlationId) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = type,
            Component = ComponentWildcard,
            CorrelationId = correlationId,
            OccurredAt = DateTimeOffset.UtcNow,
        };

    // ── Cycle-field reset ─────────────────────────────────────────────────────

    /// <summary>
    /// Resets all mutable fields of <paramref name="cycle"/> to their idle-state defaults.
    /// Called by the orchestrator and the reconciler on any abort/complete transition.
    /// </summary>
    internal static void ClearCycleFields(ResetCycle cycle)
    {
        cycle.State = Repositories.ResetState.Idle;
        cycle.CorrelationId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
    }
}
