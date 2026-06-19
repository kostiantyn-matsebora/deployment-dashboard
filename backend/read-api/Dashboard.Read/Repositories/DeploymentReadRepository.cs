using System.Diagnostics.CodeAnalysis;
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

    public Task<IReadOnlyList<DeploymentEvent>> GetEffectivePerSlotAsync(
        string? serviceFilter, CancellationToken ct)
        // Effective = in-progress | success | failure. Latest effective per slot.
        => LatestPerSlotByStatusAsync(
            serviceFilter,
            [DeploymentStatus.InProgress, DeploymentStatus.Success, DeploymentStatus.Failure],
            ct);

    public Task<IReadOnlyList<DeploymentEvent>> GetLatestNonEffectivePerSlotAsync(
        string? serviceFilter, CancellationToken ct)
        // Non-effective = pending | queued | waiting | cancelled | rejected. Latest per slot.
        => LatestPerSlotByStatusAsync(
            serviceFilter,
            [
                DeploymentStatus.Pending, DeploymentStatus.Queued, DeploymentStatus.Waiting,
                DeploymentStatus.Cancelled, DeploymentStatus.Rejected,
            ],
            ct);

    public Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
        string? serviceFilter, CancellationToken ct)
        // Last successful per slot.
        => LatestPerSlotByStatusAsync(serviceFilter, [DeploymentStatus.Success], ct);

    // S1541: The correlated NOT-EXISTS pattern requires checking (a) latest terminal per slot
    // and (b) latest effective event in-progress above it — two nested existence sub-queries
    // whose branches are not independently extractable without destroying the LINQ-to-SQL
    // translation.  Cyclomatic complexity is irreducible for this query shape.
    [SuppressMessage("SonarAnalyzer", "S1541", Justification = "Correlated NOT-EXISTS sub-queries for prev_failed rule: cyclomatic complexity is irreducible without breaking LINQ-to-SQL translation.")]
    public async Task<IReadOnlyList<DeploymentEvent>> GetLatestTerminalBeforeCurrentPerSlotAsync(
        string? serviceFilter, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        // Terminal = success | failure.
        var terminalStatuses = new[] { DeploymentStatus.Success, DeploymentStatus.Failure };

        // We want: the latest terminal event per slot, provided that:
        //   (a) the latest EFFECTIVE event in the same slot is in-progress (prev_failed is
        //       only meaningful when current is in-progress), AND
        //   (b) no newer terminal event exists in the same slot
        //       (i.e. this event IS the latest terminal).
        //
        // Effective = in-progress | success | failure.
        var effectiveStatuses = new[] { DeploymentStatus.InProgress, DeploymentStatus.Success, DeploymentStatus.Failure };

        var rawTerminal = await q
            .Where(e => terminalStatuses.Contains(e.Status) &&
                        // (b) This is the latest terminal event in the slot.
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Namespace == e.Namespace &&
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            terminalStatuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt) &&
                        // (a) The latest effective event in this slot is in-progress.
                        db.DeploymentEvents.Any(e2 =>
                            e2.Namespace == e.Namespace &&
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            e2.Status == DeploymentStatus.InProgress &&
                            e2.HappenedAt > e.HappenedAt &&
                            !db.DeploymentEvents.Any(e3 =>
                                e3.Namespace == e.Namespace &&
                                e3.Service == e.Service &&
                                e3.Environment == e.Environment &&
                                effectiveStatuses.Contains(e3.Status) &&
                                e3.HappenedAt > e2.HappenedAt)))
            .ToListAsync(ct);

        // In-memory tiebreak: keep the event with the greatest Id per slot.
        return LatestPerSlot(rawTerminal);
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

    /// <summary>
    /// Latest event per slot whose status is in <paramref name="statuses"/>: the row for which
    /// no newer same-set event exists in the same (service, environment) slot. The correlated
    /// NOT EXISTS translates to SQL on both Postgres and SQLite.
    /// </summary>
    private async Task<IReadOnlyList<DeploymentEvent>> LatestPerSlotByStatusAsync(
        string? serviceFilter, string[] statuses, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (serviceFilter is not null)
            q = q.Where(e => e.Service == serviceFilter);

        var raw = await q
            .Where(e => statuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Namespace == e.Namespace &&
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            statuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        return LatestPerSlot(raw);
    }

    /// <summary>
    /// In-memory tiebreak when several events in a slot share the max <c>happened_at</c>: keep the
    /// one with the greatest <c>Id</c>. Per API spec D2/D3 the UUIDv7 <c>Id</c> is the canonical
    /// insert-time-ordered cursor, so "greatest Id" deterministically means "latest insert" — the
    /// same key the listing/pagination tiebreak uses; there is no other insertion-order column to
    /// appeal to.
    /// </summary>
    private static IReadOnlyList<DeploymentEvent> LatestPerSlot(List<DeploymentEvent> raw) =>
        raw
            .GroupBy(e => (e.Namespace, e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
}
