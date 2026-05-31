using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Repositories;

internal sealed class ResetCycleRepository(DashboardDbContext db) : IResetCycleRepository
{
    private const short FixedId = 1;

    public async Task<ResetCycle> LoadAsync(CancellationToken ct)
    {
        // The row is always present (seeded by migration). FindAsync is used for the EF
        // change-tracker lookup path; the caller clears the tracker before calling here.
        return await db.ResetCycles.FindAsync([FixedId], ct)
               ?? new ResetCycle { Id = FixedId, State = ResetState.Idle };
    }

    /// <summary>
    /// Atomic conditional UPDATE: <c>WHERE id=1 AND state='idle'</c>.
    /// Returns <c>true</c> iff exactly one row was updated (this caller won).
    /// Because the row is always present (seeded), there is no INSERT race.
    /// </summary>
    public async Task<bool> TryClaimIdleAsync(ResetCycle claimedCycle, CancellationToken ct)
    {
        var affected = await db.ResetCycles
            .Where(r => r.Id == FixedId && r.State == ResetState.Idle)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.State, claimedCycle.State)
                .SetProperty(r => r.ResetId, claimedCycle.ResetId)
                .SetProperty(r => r.ExpectedComponents, claimedCycle.ExpectedComponents)
                .SetProperty(r => r.AcksReceived, claimedCycle.AcksReceived)
                .SetProperty(r => r.StartedAt, claimedCycle.StartedAt)
                .SetProperty(r => r.DeadlineAt, claimedCycle.DeadlineAt),
            ct);

        return affected > 0;
    }

    public async Task SaveAsync(ResetCycle cycle, CancellationToken ct)
    {
        var existing = await db.ResetCycles.FindAsync([FixedId], ct);
        if (existing is null)
        {
            // Should not happen after migration seed, but guard defensively.
            db.ResetCycles.Add(cycle);
        }
        else
        {
            existing.State = cycle.State;
            existing.ResetId = cycle.ResetId;
            existing.ExpectedComponents = cycle.ExpectedComponents;
            existing.AcksReceived = cycle.AcksReceived;
            existing.StartedAt = cycle.StartedAt;
            existing.DeadlineAt = cycle.DeadlineAt;
        }

        await db.SaveChangesAsync(ct);
    }
}
