using System.Diagnostics.CodeAnalysis;
using Dashboard.Read.Cursors;
using Dashboard.Read.Queries;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Repositories;

internal sealed class DeploymentReadRepository(
    DashboardDbContext db,
    ServiceFilter serviceFilter) : IDeploymentReadRepository
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

        // The deployment-wide service filter is applied in-memory after the DB fetch.
        // Load all matching rows (no Take here) then filter and page in memory.
        // The per-request ?service= / ?environment= parameters already constrain the DB query;
        // this layer applies the wider deployment-wide glob filter on top.
        var raw = await q.ToListAsync(ct);
        var filtered = raw.Where(e => serviceFilter.Permits(e.Service, e.Namespace)).ToList();

        string? nextCursor = null;
        IReadOnlyList<DeploymentEvent> page;
        if (filtered.Count > query.Limit)
        {
            // Encode cursor from the last item that IS returned (index Limit-1),
            // so the next page seeks to HappenedAt < that item's timestamp.
            var lastReturned = filtered[query.Limit - 1];
            nextCursor = CursorCodec.Encode(lastReturned.HappenedAt, lastReturned.Id);
            page = filtered.Take(query.Limit).ToList();
        }
        else
        {
            page = filtered;
        }

        return (page, nextCursor);
    }

    public async Task<DeploymentEvent?> GetByIdAsync(Guid id, CancellationToken ct)
        => await db.DeploymentEvents.FindAsync([id], ct);

    public Task<IReadOnlyList<DeploymentEvent>> GetEffectivePerSlotAsync(
        string? slotServiceFilter, CancellationToken ct)
        // Effective = in-progress | success | failure. Latest effective per slot.
        => LatestPerSlotByStatusAsync(
            slotServiceFilter,
            [DeploymentStatus.InProgress, DeploymentStatus.Success, DeploymentStatus.Failure],
            ct);

    public Task<IReadOnlyList<DeploymentEvent>> GetLatestNonEffectivePerSlotAsync(
        string? slotServiceFilter, CancellationToken ct)
        // Non-effective = pending | queued | waiting | cancelled | rejected. Latest per slot.
        => LatestPerSlotByStatusAsync(
            slotServiceFilter,
            [
                DeploymentStatus.Pending, DeploymentStatus.Queued, DeploymentStatus.Waiting,
                DeploymentStatus.Cancelled, DeploymentStatus.Rejected,
            ],
            ct);

    public Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
        string? slotServiceFilter, CancellationToken ct)
        // Last successful per slot.
        => LatestPerSlotByStatusAsync(slotServiceFilter, [DeploymentStatus.Success], ct);

    // S1541: The correlated NOT-EXISTS pattern requires checking (a) latest terminal per slot
    // and (b) latest effective event in-progress above it — two nested existence sub-queries
    // whose branches are not independently extractable without destroying the LINQ-to-SQL
    // translation.  Cyclomatic complexity is irreducible for this query shape.
    [SuppressMessage("SonarAnalyzer", "S1541", Justification = "Correlated NOT-EXISTS sub-queries for prev_failed rule: cyclomatic complexity is irreducible without breaking LINQ-to-SQL translation.")]
    public async Task<IReadOnlyList<DeploymentEvent>> GetLatestTerminalBeforeCurrentPerSlotAsync(
        string? slotServiceFilter, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (slotServiceFilter is not null)
            q = q.Where(e => e.Service == slotServiceFilter);

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

        // Apply deployment-wide filter then tiebreak per slot.
        var slotFiltered = ApplyDeploymentWideFilter(rawTerminal);
        return LatestPerSlot(slotFiltered);
    }

    public async Task<IReadOnlyList<string>> GetDistinctServicesAsync(CancellationToken ct)
    {
        var all = await db.DeploymentEvents
            .Select(e => new { e.Service, e.Namespace })
            .Distinct()
            .OrderBy(x => x.Service)
            .ToListAsync(ct);

        // Apply deployment-wide filter: include only service names where at least one
        // (service, namespace) combination passes the filter. Deduplicate after filtering
        // so a name visible under one namespace is not hidden if another namespace is excluded.
        return all
            .Where(x => serviceFilter.Permits(x.Service, x.Namespace))
            .Select(x => x.Service)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<IReadOnlyList<string>> GetDistinctEnvironmentsAsync(CancellationToken ct)
        => await db.DeploymentEvents
            .Select(e => e.Environment)
            .Distinct()
            .OrderBy(e => e)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<DeploymentEvent>> GetSinceAsync(
        Guid lastId, string? slotServiceFilter, CancellationToken ct)
    {
        // EF Core cannot express `uuid > @lastId` via LINQ (Guid has no > operator).
        // FromSqlInterpolated produces a safe parameterised query; Postgres uuid > operator
        // orders UUIDv7 by insertion time, matching the spec D3 resume semantics.
        var q = db.DeploymentEvents
            .FromSqlInterpolated($"SELECT * FROM deployment_events WHERE id > {lastId}");

        if (slotServiceFilter is not null)
            q = q.Where(e => e.Service == slotServiceFilter);

        var raw = await q.OrderBy(e => e.Id).ToListAsync(ct);
        return ApplyDeploymentWideFilter(raw);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Latest event per slot whose status is in <paramref name="statuses"/>: the row for which
    /// no newer same-set event exists in the same (service, environment) slot. The correlated
    /// NOT EXISTS translates to SQL on both Postgres and SQLite.
    /// </summary>
    private async Task<IReadOnlyList<DeploymentEvent>> LatestPerSlotByStatusAsync(
        string? slotServiceFilter, string[] statuses, CancellationToken ct)
    {
        var q = db.DeploymentEvents.AsQueryable();
        if (slotServiceFilter is not null)
            q = q.Where(e => e.Service == slotServiceFilter);

        var raw = await q
            .Where(e => statuses.Contains(e.Status) &&
                        !db.DeploymentEvents.Any(e2 =>
                            e2.Namespace == e.Namespace &&
                            e2.Service == e.Service &&
                            e2.Environment == e.Environment &&
                            statuses.Contains(e2.Status) &&
                            e2.HappenedAt > e.HappenedAt))
            .ToListAsync(ct);

        var filtered = ApplyDeploymentWideFilter(raw);
        return LatestPerSlot(filtered);
    }

    private List<DeploymentEvent> ApplyDeploymentWideFilter(List<DeploymentEvent> events) =>
        events.Where(e => serviceFilter.Permits(e.Service, e.Namespace)).ToList();

    /// <summary>
    /// In-memory tiebreak: given multiple events per slot (same max happened_at),
    /// keep the one with the greatest Id (most recently inserted UUIDv7).
    /// </summary>
    private static IReadOnlyList<DeploymentEvent> LatestPerSlot(List<DeploymentEvent> raw) =>
        raw
            .GroupBy(e => (e.Namespace, e.Service, e.Environment))
            .Select(g => g.OrderByDescending(e => e.Id).First())
            .ToList();
}
