using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Repositories;

internal sealed class ResetCycleRepository(DashboardDbContext db) : IResetCycleRepository
{
    private const short FixedId = 1;

    public async Task<ResetCycle> LoadAsync(CancellationToken ct)
    {
        return await db.ResetCycles.FindAsync([FixedId], ct)
               ?? new ResetCycle { Id = FixedId, State = ResetState.Idle };
    }

    public async Task SaveAsync(ResetCycle cycle, CancellationToken ct)
    {
        var existing = await db.ResetCycles.FindAsync([FixedId], ct);
        if (existing is null)
        {
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
