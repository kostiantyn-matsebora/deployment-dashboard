using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;

namespace Dashboard.Write.Repositories;

internal sealed class FetcherStateRepository(DashboardDbContext db) : IFetcherStateRepository
{
    public async Task<FetcherState?> GetByAdapterAsync(string adapter, CancellationToken ct)
        => await db.FetcherStates.FindAsync([adapter], ct);

    public async Task UpsertAsync(string adapter, string cursor, CancellationToken ct)
    {
        var existing = await db.FetcherStates.FindAsync([adapter], ct);
        if (existing is null)
        {
            db.FetcherStates.Add(new FetcherState
            {
                Adapter = adapter,
                Cursor = cursor,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            existing.Cursor = cursor;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }
}
