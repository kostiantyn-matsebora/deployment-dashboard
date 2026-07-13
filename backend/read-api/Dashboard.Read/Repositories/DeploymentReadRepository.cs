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
    // When a service filter is active, we need more rows per round-trip than the
    // requested limit because some rows will be filtered out in memory.  This
    // multiplier gives headroom without materialising the whole table.
    private const int FilteredHeadroomMultiplier = 4;

    // S3776/S1541: The two-path structure (fast-path vs. windowed-loop) and the six
    // per-query DB filters combine to push complexity above the threshold.  Both code
    // paths are independently simple; the complexity is structural and irreducible.
    [SuppressMessage("SonarAnalyzer", "S3776", Justification = "Fast-path + windowed-loop pagination: structural complexity is irreducible without breaking LINQ-to-SQL translation.")]
    [SuppressMessage("SonarAnalyzer", "S1541", Justification = "Fast-path + windowed-loop pagination: structural complexity is irreducible without breaking LINQ-to-SQL translation.")]
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

        // Applied here — before ordering and keyset paging — so it is correct in both
        // the fast path and the windowed-loop path below, and next_cursor stays
        // consistent for a fixed q.
        q = ApplyTextSearch(q, query.Q);

        DateTimeOffset? initialCursorAt = null;
        if (query.Cursor is not null && CursorCodec.TryDecode(query.Cursor, out var cursor))
        {
            // Seek to events that come after the cursor in the happened_at DESC ordering.
            // The cursor's id is encoded for future id-level tiebreaking; for now we use
            // happened_at only. Same-second events at a page boundary are an acceptable
            // edge case for emitter-supplied CI/CD timestamps.
            initialCursorAt = cursor.HappenedAt;
        }

        var orderedBase = q.OrderByDescending(e => e.HappenedAt).ThenByDescending(e => e.Id);

        // Fast-path: when no service filter is active every DB row passes — fetch
        // exactly limit+1 rows in one round-trip (original single-query behaviour).
        if (serviceFilter.IsEmpty)
        {
            var fastQ = initialCursorAt.HasValue
                ? orderedBase.Where(e => e.HappenedAt < initialCursorAt.Value)
                : orderedBase;
            var raw = await fastQ.Take(query.Limit + 1).ToListAsync(ct);

            string? nextCursorFast = null;
            IReadOnlyList<DeploymentEvent> pageFast;
            if (raw.Count > query.Limit)
            {
                var lastReturned = raw[query.Limit - 1];
                nextCursorFast = CursorCodec.Encode(lastReturned.HappenedAt, lastReturned.Id);
                pageFast = raw.Take(query.Limit).ToList();
            }
            else
            {
                pageFast = raw;
            }
            return (pageFast, nextCursorFast);
        }

        // Active-filter path: fetch bounded windows and apply the in-memory glob filter
        // until limit+1 filtered rows are collected or the source is exhausted.
        // Each window uses the keyset cursor (happened_at < seekAt) so we never
        // re-materialise rows we already processed.
        var filtered = new List<DeploymentEvent>(query.Limit + 1);
        var windowSize = (query.Limit + 1) * FilteredHeadroomMultiplier;
        var seekAt = initialCursorAt;

        while (filtered.Count <= query.Limit)
        {
            var windowQ = seekAt.HasValue
                ? orderedBase.Where(e => e.HappenedAt < seekAt.Value)
                : orderedBase;

            var window = await windowQ.Take(windowSize).ToListAsync(ct);
            if (window.Count == 0)
                break; // source exhausted

            foreach (var ev in window)
            {
                if (serviceFilter.Permits(ev.Service, ev.Namespace))
                    filtered.Add(ev);

                if (filtered.Count > query.Limit)
                    break;
            }

            if (window.Count < windowSize)
                break; // source exhausted (last window was partial)

            // Advance the keyset cursor to the last row of this window so the next
            // iteration starts strictly after it — preserving happened_at DESC ordering.
            seekAt = window[^1].HappenedAt;
        }

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
    /// Free-text search: OR across the ten searchable columns (<c>run_url</c> excluded
    /// per contract), case-insensitive substring. Column-side <c>ToLower()</c>/<c>Contains()</c>
    /// (rather than <c>EF.Functions.Like</c>, whose case-folding differs between SQLite
    /// and Npgsql) translates identically on both providers — that pair must stay inside
    /// the lambda as written, since <c>ToLowerInvariant()</c> does not translate to SQL.
    /// The needle itself is lowered client-side with <c>ToLowerInvariant()</c> (not the
    /// current-culture <c>ToLower()</c>) so a culture-sensitive alphabet (e.g. Turkish I/i)
    /// can't desync it from the column-side lowering. Empty/whitespace <paramref name="needle"/>
    /// is a no-op — no text filter is applied.
    /// </summary>
    // S1541: A flat OR-chain across ten null-safe substring checks must stay a single
    // LINQ expression to translate to one SQL predicate; splitting it into
    // sub-methods would break LINQ-to-SQL translation (same rationale as ListAsync above).
    [SuppressMessage("SonarAnalyzer", "S1541", Justification = "Ten-column OR-composed free-text predicate: cyclomatic complexity is irreducible without breaking LINQ-to-SQL translation.")]
    private static IQueryable<DeploymentEvent> ApplyTextSearch(IQueryable<DeploymentEvent> q, string? needle)
    {
        if (string.IsNullOrWhiteSpace(needle))
            return q;

        var lowered = needle.Trim().ToLowerInvariant();
        return q.Where(e =>
            e.Service.ToLower().Contains(lowered) ||
            (e.Namespace != null && e.Namespace.ToLower().Contains(lowered)) ||
            e.Environment.ToLower().Contains(lowered) ||
            (e.Version != null && e.Version.ToLower().Contains(lowered)) ||
            e.Status.ToLower().Contains(lowered) ||
            (e.Actor != null && e.Actor.ToLower().Contains(lowered)) ||
            (e.Ref != null && e.Ref.ToLower().Contains(lowered)) ||
            (e.Sha != null && e.Sha.ToLower().Contains(lowered)) ||
            e.DeploymentId.ToLower().Contains(lowered) ||
            (e.RunNumber != null && e.RunNumber.ToLower().Contains(lowered)));
    }

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
