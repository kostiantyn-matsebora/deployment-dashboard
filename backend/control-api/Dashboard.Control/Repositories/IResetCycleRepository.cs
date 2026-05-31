using Dashboard.Shared.Entities;

namespace Dashboard.Control.Repositories;

/// <summary>
/// Persistence for the single-row <c>reset_cycle</c> state used by the choreography state machine (D12).
/// All reads/writes are wrapped in an advisory-lock transaction by the caller.
/// </summary>
internal interface IResetCycleRepository
{
    /// <summary>
    /// Loads the current reset cycle row, or returns a synthetic <c>idle</c> row if none exists yet.
    /// </summary>
    Task<ResetCycle> LoadAsync(CancellationToken ct);

    /// <summary>
    /// Upserts the reset cycle row (insert-or-replace by fixed PK = 1).
    /// </summary>
    Task SaveAsync(ResetCycle cycle, CancellationToken ct);
}
