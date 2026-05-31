using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Repositories;

internal sealed class ControlStreamRepository(DashboardDbContext db) : IControlStreamRepository
{
    public async Task InsertAsync(ControlStreamEvent entity, CancellationToken ct)
    {
        db.ControlStreamEvents.Add(entity);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<ControlStreamEvent>> GetSinceAsync(
        Guid lastId, string? component, CancellationToken ct)
    {
        // EF Core cannot express `uuid > @lastId` via LINQ (Guid has no > operator).
        // FromSqlInterpolated produces a safe parameterised query; Postgres orders UUIDv7 by
        // insertion time, matching the D3 resume semantics (same approach as the read side).
        var q = db.ControlStreamEvents
            .FromSqlInterpolated($"SELECT * FROM control_stream_events WHERE id > {lastId}");

        if (component is not null)
            q = q.Where(e => e.Component == component || e.Component == "*");

        return await q.OrderBy(e => e.Id).ToListAsync(ct);
    }
}
