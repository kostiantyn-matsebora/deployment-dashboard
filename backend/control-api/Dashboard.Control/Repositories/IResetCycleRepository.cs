using Dashboard.Shared.Entities;

namespace Dashboard.Control.Repositories;

/// <summary>
/// Persistence for the single-row <c>reset_cycle</c> state used by the choreography state machine (D12).
/// </summary>
internal interface IResetCycleRepository
{
    /// <summary>
    /// Loads the current reset cycle row. The row always exists (seeded by migration).
    /// </summary>
    Task<ResetCycle> LoadAsync(CancellationToken ct);

    /// <summary>
    /// Atomically transitions <c>state='idle' → state='draining'</c> using a conditional UPDATE.
    /// Returns <c>true</c> when the row was updated (this caller won the race);
    /// <c>false</c> when the row was not idle (another instance or request already claimed it → 409).
    /// </summary>
    Task<bool> TryClaimIdleAsync(ResetCycle claimedCycle, CancellationToken ct);

    /// <summary>
    /// Upserts all fields of the reset cycle row unconditionally (used by the orchestrator and reconciler
    /// that already hold the advisory lock and own the current state).
    /// </summary>
    Task SaveAsync(ResetCycle cycle, CancellationToken ct);

    /// <summary>
    /// Atomically releases the row to the idle baseline (state=idle, correlation/acks/timers
    /// cleared, operation=reset, recover_since=null) via a conditional UPDATE:
    /// <c>WHERE id=1 AND (correlation_id = @expectedCorrelationId OR state = 'idle')</c>.
    /// <para>
    /// The <c>correlation_id</c> arm guards the normal case — only the orchestrator/reconciler that
    /// actually owns the in-flight cycle (its correlation still matches the row) may move it to
    /// idle. The <c>state = 'idle'</c> arm keeps the release idempotent when there is nothing to
    /// protect (row already idle, e.g. a redundant abort call) without ever letting a genuinely
    /// in-flight, differently-correlated cycle — a newer claim that superseded a stale/leaked
    /// writer — get clobbered.
    /// </para>
    /// Returns <c>true</c> iff exactly one row was updated; <c>false</c> means this caller's
    /// cycle was superseded and the write no-oped — the row must be left exactly as-is.
    /// </summary>
    Task<bool> TryReleaseToIdleAsync(Guid expectedCorrelationId, CancellationToken ct);
}
