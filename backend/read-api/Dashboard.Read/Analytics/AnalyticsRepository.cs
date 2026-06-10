using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Analytics;

/// <summary>
/// PostgreSQL / EF Core implementation of <see cref="IAnalyticsRepository"/>.
/// Uses group-by / time-bucket SQL over <c>deployment_events</c> — no client-side
/// aggregation, no event-stream replay.
/// </summary>
internal sealed class AnalyticsRepository(DashboardDbContext db) : IAnalyticsRepository
{
    private static readonly string[] TerminalStatuses =
        [DeploymentStatus.Success, DeploymentStatus.Failure];

    private static readonly string[] FunnelEnvironments =
        ["dev", "staging", "qa", "preprod", "prod"];

    // ── DORA Four Keys ────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<DailyTerminalCounts>> GetDailyTerminalCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        // Group terminal events by UTC date and status; merge in-memory into daily buckets.
        var rows = await db.DeploymentEvents
            .Where(e => TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .GroupBy(e => new
            {
                e.Status,
                Date = DateOnly.FromDateTime(e.HappenedAt.UtcDateTime.Date),
            })
            .Select(g => new { g.Key.Status, g.Key.Date, Count = g.Count() })
            .ToListAsync(ct);

        return rows
            .GroupBy(r => r.Date)
            .Select(g => new DailyTerminalCounts(
                g.Key,
                g.Where(r => r.Status == DeploymentStatus.Success).Sum(r => r.Count),
                g.Where(r => r.Status == DeploymentStatus.Failure).Sum(r => r.Count)))
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
        var events = await db.DeploymentEvents
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
        var durations = await db.DeploymentEvents
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
        var rows = await db.DeploymentEvents
            .Where(e => FunnelEnvironments.Contains(e.Environment)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to)
            .GroupBy(e => e.Environment)
            .Select(g => new
            {
                Environment = g.Key,
                Count = g.Select(e => e.DeploymentId).Distinct().Count(),
            })
            .ToListAsync(ct);

        var map = rows.ToDictionary(r => r.Environment, r => r.Count);
        return FunnelEnvironments
            .Select(env => new FunnelStageCount(env, map.GetValueOrDefault(env, 0)))
            .ToList();
    }

    public async Task<IReadOnlyList<StatusCount>> GetStatusCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var rows = await db.DeploymentEvents
            .Where(e => e.HappenedAt >= from && e.HappenedAt < to)
            .GroupBy(e => e.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        return rows.Select(r => new StatusCount(r.Status, r.Count)).ToList();
    }

    public async Task<IReadOnlyList<HeatmapCell>> GetHeatmapCellsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct)
    {
        var happenedAts = await db.DeploymentEvents
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
        var qualifyingDeploymentIds = await db.DeploymentEvents
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
        var eventRows = await db.DeploymentEvents
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
        var events = await db.DeploymentEvents
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
        => await db.DeploymentEvents
            .Where(e => e.Environment == "prod"
                        && TerminalStatuses.Contains(e.Status)
                        && e.HappenedAt >= from
                        && e.HappenedAt < to
                        && e.ParentDeployments != null
                        && e.ParentDeployments.Length > 0)
            .OrderBy(e => e.HappenedAt)
            .ToListAsync(ct);

    private async Task<Dictionary<string, DateTimeOffset>> FetchParentMinTimesAsync(
        List<string> parentIds, CancellationToken ct)
        => await db.DeploymentEvents
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
