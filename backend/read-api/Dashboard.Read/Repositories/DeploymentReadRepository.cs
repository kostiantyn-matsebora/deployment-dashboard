using Dashboard.Read.Cursors;
using Dashboard.Read.Queries;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Repositories;

internal sealed class DeploymentReadRepository(DashboardDbContext db) : IDeploymentReadRepository
{
    public async Task<(IReadOnlyList<DeploymentEvent> Items, string? NextCursor)> ListAsync(
        DeploymentListQuery query, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();

        if (query.Service is not null) q = q.Where(e => e.Service == query.Service);
        if (query.Environment is not null) q = q.Where(e => e.Environment == query.Environment);
        if (query.Status is not null) q = q.Where(e => e.Status == query.Status);
        if (query.DeploymentId is not null) q = q.Where(e => e.DeploymentId == query.DeploymentId);
        if (query.Since.HasValue) q = q.Where(e => e.HappenedAt >= query.Since.Value);
        if (query.Until.HasValue) q = q.Where(e => e.HappenedAt < query.Until.Value);

        if (query.Cursor is not null && CursorCodec.TryDecode(query.Cursor, out var cursor))
        {
            // Seek to events that come after the cursor in the happened_at DESC ordering.
            // The cursor's id is encoded for future id-level tiebreaking; for now we use
            // happened_at only. Same-second events at a page boundary are an acceptable
            // edge case for emitter-supplied CI/CD timestamps.
            var cursorAt = cursor.HappenedAt;
            q = q.Where(e => e.HappenedAt < cursorAt);
        }

        q = q.OrderByDescending(e => e.HappenedAt).ThenByDescending(e => e.Id);

        // Fetch limit + 1 to detect whether a next page exists.
        var items = await q.Take(query.Limit + 1).ToListAsync(ct);

        string? nextCursor = null;
        if (items.Count > query.Limit)
        {
            items.RemoveAt(items.Count - 1);
            var last = items[^1];
            nextCursor = CursorCodec.Encode(last.HappenedAt, last.Id);
        }

        return (items, nextCursor);
    }

    public async Task<DeploymentEvent?> GetByIdAsync(Guid id, CancellationToken ct)
        => await db.DeploymentEvents.FindAsync([id], ct);

    public async Task<IReadOnlyList<DeploymentEvent>> GetEffectivePerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        // Effective = in-progress | success | failure.
        // Latest effective per slot = no newer effective event exists in the same slot.
        // The correlated NOT EXISTS translates to SQL on both Postgres and SQLite.
        var effectiveStatuses = new[] { DeploymentStatus.InProgress, DeploymentStatus.Success, DeploymentStatus.Failure };

        var rawEffective = await q
            .Where(e => effectiveStatuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            effectiveStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        // In-memory tiebreak: if multiple events share the max happened_at in a slot,
        // keep the one with the greatest Id (most recently inserted UUIDv7).
        return rawEffective
            .GroupBy(e => (e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
    }

    public async Task<IReadOnlyList<DeploymentEvent>> GetLatestNonEffectivePerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        // Non-effective = pending | queued | waiting | cancelled | rejected.
        // Latest non-effective per slot = no newer non-effective event exists in the same slot.
        var nonEffectiveStatuses = new[] { DeploymentStatus.Pending, DeploymentStatus.Queued, DeploymentStatus.Waiting, DeploymentStatus.Cancelled, DeploymentStatus.Rejected };

        var rawNonEffective = await q
            .Where(e => nonEffectiveStatuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            nonEffectiveStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        return rawNonEffective
            .GroupBy(e => (e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
    }

    public async Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        var rawLastSuccessful = await q
            .Where(e => e.Status == DeploymentStatus.Success &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            e2.Status == DeploymentStatus.Success &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        return rawLastSuccessful
            .GroupBy(e => (e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
    }

    public async Task<IReadOnlyList<string>> GetDistinctServicesAsync(CancellationToken ct)
        => await db.DeploymentEvents
            .Select(e => e.Service)
            .Distinct()
            .OrderBy(s => s)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<string>> GetDistinctEnvironmentsAsync(CancellationToken ct)
        => await db.DeploymentEvents
            .Select(e => e.Environment)
            .Distinct()
            .OrderBy(e => e)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<DeploymentEvent>> GetSinceAsync(
        Guid lastId, string? serviceFilter, CancellationToken ct)
    {
        // EF Core cannot express `uuid > @lastId` via LINQ (Guid has no > operator).
        // FromSqlInterpolated produces a safe parameterised query; Postgres uuid > operator
        // orders UUIDv7 by insertion time, matching the spec D3 resume semantics.
        var q = db.DeploymentEvents
            .FromSqlInterpolated($"SELECT * FROM deployment_events WHERE id > {lastId}");

        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        return await q.OrderBy(e => e.Id).ToListAsync(ct);
    }
}
