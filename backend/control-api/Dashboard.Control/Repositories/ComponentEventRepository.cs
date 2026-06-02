using Dashboard.Control.Models;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Repositories;

internal sealed class ComponentEventRepository(DashboardDbContext db) : IComponentEventRepository
{
    public async Task InsertAsync(ComponentEvent entity, CancellationToken ct)
    {
        db.ComponentEvents.Add(entity);
        await db.SaveChangesAsync(ct);
    }

    public async Task<ComponentEvent?> GetByIdAsync(Guid id, CancellationToken ct)
        => await db.ComponentEvents.FindAsync([id], ct);

    public async Task<IReadOnlyList<ComponentEventRecord>> GetSinceAsync(Guid lastId, CancellationToken ct)
    {
        // EF Core cannot express `uuid > @lastId` via LINQ (Guid has no > operator).
        // FromSqlInterpolated produces a safe parameterised query; Postgres orders UUIDv7 by
        // insertion time, matching the D3 resume semantics (same approach as the read side).
        var items = await db.ComponentEvents
            .FromSqlInterpolated($"SELECT * FROM component_events WHERE id > {lastId}")
            .OrderBy(e => e.Id)
            .ToListAsync(ct);

        return items.Select(ComponentEventRecord.FromEntity).ToList();
    }
}
