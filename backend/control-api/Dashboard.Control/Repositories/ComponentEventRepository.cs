using Dashboard.Control.Cursors;
using Dashboard.Control.Models;
using Dashboard.Control.Queries;
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

    public async Task<(IReadOnlyList<ComponentEventRecord> Items, string? NextCursor)> ListAsync(
        ComponentEventListQuery query, CancellationToken ct)
    {
        var q = db.ComponentEvents.AsQueryable();

        if (query.ComponentId is not null) q = q.Where(e => e.ComponentId == query.ComponentId);
        if (query.EventType is not null) q = q.Where(e => e.EventType == query.EventType);
        if (query.Since.HasValue) q = q.Where(e => e.OccurredAt >= query.Since.Value);

        if (query.Cursor is not null && ComponentEventCursor.TryDecode(query.Cursor, out var cursor))
        {
            // Seek past the cursor in the received_at DESC ordering. received_at is server-assigned;
            // same-instant ties at a page boundary are an acceptable edge case (mirrors the read side).
            var cursorAt = cursor.ReceivedAt;
            q = q.Where(e => e.ReceivedAt < cursorAt);
        }

        q = q.OrderByDescending(e => e.ReceivedAt).ThenByDescending(e => e.Id);

        // Fetch limit + 1 to detect whether a next page exists.
        var items = await q.Take(query.Limit + 1).ToListAsync(ct);

        string? nextCursor = null;
        if (items.Count > query.Limit)
        {
            items.RemoveAt(items.Count - 1);
            var last = items[^1];
            nextCursor = ComponentEventCursor.Encode(last.ReceivedAt, last.Id);
        }

        var records = items.Select(ComponentEventRecord.FromEntity).ToList();
        return (records, nextCursor);
    }
}
