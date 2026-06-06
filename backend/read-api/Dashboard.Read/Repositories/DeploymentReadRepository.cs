using Dashboard.Read.Cursors;
using Dashboard.Read.Queries;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Repositories;

internal sealed class DeploymentReadRepository(DashboardDbContext db) : IDeploymentReadRepository
{
    // ── Status classification constants ───────────────────────────────────────

    private static readonly string[] EffectiveStatuses =
        [DeploymentStatus.InProgress, DeploymentStatus.Success, DeploymentStatus.Failure];

    private static readonly string[] NonEffectiveStatuses =
        [DeploymentStatus.Pending, DeploymentStatus.Queued, DeploymentStatus.Waiting,
         DeploymentStatus.Cancelled, DeploymentStatus.Rejected];

    private static readonly string[] TerminalStatuses =
        [DeploymentStatus.Success, DeploymentStatus.Failure];

    // ── Public API ────────────────────────────────────────────────────────────

    public async Task<(IReadOnlyList<DeploymentEvent> Items, string? NextCursor)> ListAsync(
        DeploymentListQuery query, CancellationToken ct)
    {
        var q = ApplyListFilters(db.DeploymentEvents.AsQueryable(), query);

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
        var q = ApplyServiceFilter(db.DeploymentEvents.AsQueryable(), serviceFilter);

        // Effective = in-progress | success | failure.
        // Latest effective per slot = no newer effective event exists in the same slot.
        // The correlated NOT EXISTS translates to SQL on both Postgres and SQLite.
        var raw = await q
            .Where(e => EffectiveStatuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            EffectiveStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        // In-memory tiebreak: if multiple events share the max happened_at in a slot,
        // keep the one with the greatest Id (most recently inserted UUIDv7).
        return TiebreakByIdPerSlot(raw);
    }

    public async Task<IReadOnlyList<DeploymentEvent>> GetLatestNonEffectivePerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = ApplyServiceFilter(db.DeploymentEvents.AsQueryable(), serviceFilter);

        // Non-effective = pending | queued | waiting | cancelled | rejected.
        // Latest non-effective per slot = no newer non-effective event exists in the same slot.
        var raw = await q
            .Where(e => NonEffectiveStatuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            NonEffectiveStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        return TiebreakByIdPerSlot(raw);
    }

    public async Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = ApplyServiceFilter(db.DeploymentEvents.AsQueryable(), serviceFilter);

        var raw = await q
            .Where(e => e.Status == DeploymentStatus.Success &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            e2.Status == DeploymentStatus.Success &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        return TiebreakByIdPerSlot(raw);
    }

    public async Task<IReadOnlyList<DeploymentEvent>> GetLatestTerminalBeforeCurrentPerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = ApplyServiceFilter(db.DeploymentEvents.AsQueryable(), serviceFilter);

        // We want: the latest terminal event per slot, provided that:
        //   (a) the latest EFFECTIVE event in the same slot is in-progress (prev_failed is
        //       only meaningful when current is in-progress), AND
        //   (b) no newer terminal event exists in the same slot
        //       (i.e. this event IS the latest terminal).
        //
        // Terminal = success | failure.
        // Effective = in-progress | success | failure.
        var raw = await q
            .Where(e => TerminalStatuses.Contains(e.Status) &&
                        // (b) This is the latest terminal event in the slot.
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            TerminalStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt) &&
                        // (a) The latest effective event in this slot is in-progress.
                        db.DeploymentEvents.Any(e2 =>
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            e2.Status == DeploymentStatus.InProgress &&
                            e2.HappenedAt > e.HappenedAt &&
                            !db.DeploymentEvents.Any(e3 =>
                                e3.Service == e.Service &&
                                e3.Environment == e.Environment &&
                                EffectiveStatuses.Contains(e3.Status) &&
                                e3.HappenedAt > e2.HappenedAt)))
            .ToListAsync(ct);

        // In-memory tiebreak: keep the event with the greatest Id per slot.
        return TiebreakByIdPerSlot(raw);
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

    // ── Private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Applies optional service filter to an EF queryable.
    /// </summary>
    private static IQueryable<DeploymentEvent> ApplyServiceFilter(
        IQueryable<DeploymentEvent> q, string? serviceFilter)
        => serviceFilter is not null ? q.Where(e => e.Service == serviceFilter) : q;

    /// <summary>
    /// Applies <see cref="DeploymentListQuery"/> field filters and cursor seek to a queryable.
    /// Ordering and pagination are left to the caller.
    /// </summary>
    private static IQueryable<DeploymentEvent> ApplyListFilters(
        IQueryable<DeploymentEvent> q, DeploymentListQuery query)
    {
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

        return q;
    }

    /// <summary>
    /// In-memory tiebreak: when multiple events share the max <c>happened_at</c> in a
    /// <c>(service, environment)</c> slot, the one with the greatest <c>Id</c> (most recently
    /// inserted UUIDv7) wins.
    /// </summary>
    private static IReadOnlyList<DeploymentEvent> TiebreakByIdPerSlot(
        List<DeploymentEvent> events)
        => events
            .GroupBy(e => (e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
}
