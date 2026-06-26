using System.Diagnostics;
using System.Diagnostics.CodeAnalysis;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Analytics;

/// <summary>
/// PostgreSQL / EF Core implementation of <see cref="IAnalyticsRepository"/>.
/// Uses group-by / time-bucket SQL over <c>deployment_events</c> — no client-side
/// aggregation, no event-stream replay.
/// </summary>
[SuppressMessage("SonarAnalyzer", "S1200",
    Justification = "Analytics aggregate class: coupling to all nine query-result types, EF, LINQ, and AnalyticsExcludeFilter is inherent and irreducible without fragmenting cohesive aggregation logic.")]
internal sealed class AnalyticsRepository(
    DashboardDbContext db,
    AnalyticsOptions options,
    AnalyticsExcludeFilter excludeFilter) : IAnalyticsRepository
{
    private static readonly string[] TerminalStatuses =
        [DeploymentStatus.Success, DeploymentStatus.Failure];

    // Lowercase-normalized funnel ladder from the composition root.
    // Guaranteed non-empty by AnalyticsFunnelEnvironments.Parse — [^1] is always safe.
    private readonly string[] _funnelEnvironments = options.FunnelEnvironments;

    // ── DORA Four Keys ────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DailyTerminalCounts>> GetDailyTerminalCountsAsync(
    DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        // Fetch terminal events within the window; group in-memory to daily buckets.
        // DateOnly.FromDateTime inside a GROUP BY does not translate on the SQLite test
        // provider when the query source is wrapped in a filter subquery, so the date
        // projection is computed client-side (the row set is already small — terminal
        // events in a ≤30-day window).
        var events = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .Select(e => new { e.Status, e.HappenedAt })
            .ToListAsync(ct);

        return events
            .GroupBy(e => new
            {
                e.Status,
                Date = DateOnly.FromDateTime(e.HappenedAt.UtcDateTime.Date),
            })
            .GroupBy(g => g.Key.Date)
            .Select(g => new DailyTerminalCounts(
                g.Key,
                g.Where(r => r.Key.Status == DeploymentStatus.Success).Sum(r => r.Count()),
                g.Where(r => r.Key.Status == DeploymentStatus.Failure).Sum(r => r.Count())))
            .OrderBy(b => b.Date)
            .ToList();
    }
    public async Task<IReadOnlyList<double>> GetLeadTimeHourSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        // Approximated lead time via parent_deployments promotion chains reaching prod.
        var prodTerminal = await FetchProdTerminalWithParentsAsync(from, to, ct);
        if (prodTerminal.Count == 0)
            return [];

        var parentIds = prodTerminal
            .SelectMany(e => e.ParentDeployments ?? [])
            .Distinct()
            .ToList();

        var parentMinTimes = await FetchParentMinTimesAsync(parentIds, ct);
        return ComputeLeadTimeHours(prodTerminal, parentMinTimes);
    }

    public async Task<IReadOnlyList<double>> GetMttrMinuteSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var events = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .Select(e => new SlotEvent(e.Service, e.Environment, e.Status, e.HappenedAt))
            .ToListAsync(ct);

        // Collect (failedAt, duration) pairs so we can order by happened_at before returning,
        // ensuring SampleHalfWindows splits on the earlier vs later time period correctly.
        var timed = new List<(DateTimeOffset FailedAt, double Minutes)>();
        foreach (var slot in events.GroupBy(e => (e.Service, e.Environment)))
            CollectMttrSamplesFromSlot(slot.OrderBy(e => e.HappenedAt).ToList(), timed);

        return timed.OrderBy(s => s.FailedAt).Select(s => s.Minutes).ToList();
    }

    // ── Chart series ──────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<double>> GetDurationMinuteSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var durations = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => e.HappenedAt >= from && e.HappenedAt < to)
            .GroupBy(e => e.DeploymentId)
            .Select(g => new
            {
                EarliestAt = g.Min(e => e.HappenedAt),
                LatestAt = g.Max(e => e.HappenedAt),
            })
            .ToListAsync(ct);

        return durations
            .Select(d => (d.LatestAt - d.EarliestAt).TotalMinutes)
            .Where(m => m > 0)
            .ToList();
    }

    public async Task<IReadOnlyList<FunnelStageCount>> GetFunnelCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        Debug.Assert(_funnelEnvironments.Length > 0,
            "Funnel environments must be non-empty — [^1] access would throw on an empty array.");

        // EF Core translates string[].Contains(...) to SQL IN (...).
        // Both sides are lowered: the configured list is pre-normalized to lowercase-invariant
        // (by AnalyticsFunnelEnvironments.Parse) and e.Environment is lowered in SQL via LOWER()
        // — matching regardless of the casing stored in the database.
        // DB convention is lowercase, but an operator could configure "PrOD" and it must still match.
        var funnelEnvs = _funnelEnvironments; // captured local — EF translates the array, not the field expression
        var rows = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => funnelEnvs.Contains(e.Environment.ToLower())
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .GroupBy(e => e.Environment.ToLower())
            .Select(g => new
            {
                Environment = g.Key,
                Count = g.Select(e => e.DeploymentId).Distinct().Count(),
            })
            .ToListAsync(ct);

        // Keys are already lowercase on both sides — no false negatives from case mismatch.
        var map = rows.ToDictionary(r => r.Environment, r => r.Count);
        return _funnelEnvironments
            .Select(env => new FunnelStageCount(env, map.GetValueOrDefault(env, 0)))
            .ToList();
    }

    public async Task<IReadOnlyList<StatusCount>> GetStatusCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var rows = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => e.HappenedAt >= from && e.HappenedAt < to)
            .GroupBy(e => e.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return rows.Select(r => new StatusCount(r.Status, r.Count)).ToList();
    }

    public async Task<IReadOnlyList<HeatmapCell>> GetHeatmapCellsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var happenedAts = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => e.HappenedAt >= from && e.HappenedAt < to)
            .Select(e => e.HappenedAt)
            .ToListAsync(ct);

        return happenedAts
            .GroupBy(at => ((int)at.UtcDateTime.DayOfWeek, at.UtcDateTime.Hour))
            .Select(g => new HeatmapCell(g.Key.Item1, g.Key.Item2, g.Count()))
            .Where(c => c.Count > 0)
            .OrderBy(c => c.DayOfWeek).ThenBy(c => c.Hour)
            .ToList();
    }

    public async Task<IReadOnlyList<DeployerCount>> GetTopDeployersAsync(
        DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct)
    {
        // Fetch all events for deployments that have at least one Success within the window.
        // We need events outside [from,to) only to find the earliest actor, but anchoring on
        // the Success event's HappenedAt in [from,to) keeps window semantics deterministic.
        var qualifyingDeploymentIds = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => e.Status == DeploymentStatus.Success
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .Select(e => e.DeploymentId)
            .Distinct()
            .ToListAsync(ct);

        if (qualifyingDeploymentIds.Count == 0)
            return [];

        // Fetch (deploymentId, actor, happenedAt) for all events of qualifying deployments
        // so we can find the earliest actor per deployment on the client side.
        var eventRows = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => qualifyingDeploymentIds.Contains(e.DeploymentId))
            .Select(e => new DeployerEventRow(e.DeploymentId, e.Actor, e.HappenedAt))
            .ToListAsync(ct);

        return GroupTopDeployers(eventRows, limit);
    }

    // Pure grouping logic extracted for unit-testability (no DB, no DI).
    // Attributes each qualifying deployment to the actor of its earliest event.
    internal static IReadOnlyList<DeployerCount> GroupTopDeployers(
        IEnumerable<DeployerEventRow> rows,
        int limit)
    {
        return rows
            .GroupBy(r => r.DeploymentId)
            .Select(g =>
            {
                var earliest = g.OrderBy(r => r.HappenedAt).ThenBy(r => r.Actor, StringComparer.Ordinal).First();
                return earliest.Actor ?? "unknown";
            })
            .GroupBy(actor => actor)
            .Select(g => new DeployerCount(g.Key, g.Count()))
            .OrderByDescending(d => d.Count).ThenBy(d => d.Actor, StringComparer.Ordinal)
            .Take(limit)
            .ToList();
    }

    /// <summary>Lightweight projection for the top-deployers query.</summary>
    internal sealed record DeployerEventRow(
        string DeploymentId,
        string? Actor,
        DateTimeOffset HappenedAt);

    public async Task<IReadOnlyList<IncidentRow>> GetIncidentsAsync(
        DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct)
    {
        var events = await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .Select(e => new SlotEvent(e.Service, e.Environment, e.Status, e.HappenedAt))
            .ToListAsync(ct);

        var incidents = new List<IncidentRow>();
        foreach (var slot in events.GroupBy(e => (e.Service, e.Environment)))
            CollectIncidentsFromSlot(slot.Key.Service, slot.Key.Environment,
                slot.OrderBy(e => e.HappenedAt).ToList(), incidents);

        return incidents
            .OrderByDescending(inc => inc.RestoredAt == null ? double.MaxValue
                : (inc.RestoredAt.Value - inc.FailedAt).TotalMinutes)
            .Take(limit)
            .ToList();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private async Task<List<Shared.Entities.DeploymentEvent>> FetchProdTerminalWithParentsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        Debug.Assert(_funnelEnvironments.Length > 0,
            "Funnel environments must be non-empty — [^1] access would throw on an empty array.");

        // Capture the production terminal stage into a local so EF Core translates the
        // captured value directly — not an index expression — into a SQL parameter.
        // The terminal is lowercase-normalized; compare against LOWER(e.Environment) for
        // case-insensitive matching (DB convention is lowercase, but config may vary).
        var prodEnv = _funnelEnvironments[^1];
        return await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => e.Environment.ToLower() == prodEnv
                        && TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to
                        && e.ParentDeployments != null
                        && e.ParentDeployments.Length > 0)
            .OrderBy(e => e.HappenedAt)
            .ToListAsync(ct);
    }

    private async Task<Dictionary<string, DateTimeOffset>> FetchParentMinTimesAsync(
        List<string> parentIds, CancellationToken ct)
        => await excludeFilter.Apply(db.DeploymentEvents, db)
            .Where(e => parentIds.Contains(e.DeploymentId))
            .GroupBy(e => e.DeploymentId)
            .Select(g => new { DeploymentId = g.Key, EarliestAt = g.Min(e => e.HappenedAt) })
            .ToDictionaryAsync(r => r.DeploymentId, r => r.EarliestAt, ct);

    private static List<double> ComputeLeadTimeHours(
        IReadOnlyList<Shared.Entities.DeploymentEvent> prodTerminal,
        IReadOnlyDictionary<string, DateTimeOffset> parentMinTimes)
    {
        var samples = new List<double>();
        foreach (var prod in prodTerminal)
        {
            foreach (var parentId in prod.ParentDeployments ?? [])
            {
                if (!parentMinTimes.TryGetValue(parentId, out var parentAt))
                    continue;
                var hours = (prod.HappenedAt - parentAt).TotalHours;
                if (hours > 0)
                    samples.Add(hours);
            }
        }
        return samples;
    }

    private static void CollectMttrSamplesFromSlot(
        IReadOnlyList<SlotEvent> ordered,
        List<(DateTimeOffset FailedAt, double Minutes)> samples)
    {
        for (var i = 0; i < ordered.Count; i++)
        {
            if (ordered[i].Status != DeploymentStatus.Failure) continue;
            for (var j = i + 1; j < ordered.Count; j++)
            {
                if (ordered[j].Status != DeploymentStatus.Success) continue;
                var minutes = (ordered[j].HappenedAt - ordered[i].HappenedAt).TotalMinutes;
                if (minutes > 0) samples.Add((ordered[i].HappenedAt, minutes));
                break;
            }
        }
    }

    // One incident per outage: the first Failure opens it; consecutive Failures are
    // ignored (same outage); the next Success closes it. A Success while healthy is
    // ignored. An open incident at end-of-slot is emitted with restoredAt = null.
    private static void CollectIncidentsFromSlot(
        string service,
        string environment,
        IReadOnlyList<SlotEvent> ordered,
        List<IncidentRow> incidents)
    {
        DateTimeOffset? openedAt = null;
        foreach (var ev in ordered)
        {
            if (ev.Status == DeploymentStatus.Failure)
            {
                openedAt ??= ev.HappenedAt; // first failure opens; further failures ignored
            }
            else if (ev.Status == DeploymentStatus.Success && openedAt.HasValue)
            {
                incidents.Add(new IncidentRow(service, environment, openedAt.Value, ev.HappenedAt));
                openedAt = null;
            }
        }

        if (openedAt.HasValue)
            incidents.Add(new IncidentRow(service, environment, openedAt.Value, null));
    }

    // ── Private projection type ───────────────────────────────────────────────

    /// <summary>Lightweight EF projection for terminal-event queries that only need slot + status.</summary>
    private sealed record SlotEvent(
        string Service,
        string Environment,
        string Status,
        DateTimeOffset HappenedAt);
}
