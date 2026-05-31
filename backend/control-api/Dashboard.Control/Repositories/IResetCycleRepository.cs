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
}
