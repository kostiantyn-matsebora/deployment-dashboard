namespace Dashboard.Read.Analytics;

/// <summary>
/// Server-side aggregation queries over <c>deployment_events</c> for the analytics surface.
/// All methods accept the resolved <paramref name="from"/> / <paramref name="to"/> window;
/// the window-clamping logic lives in the endpoint layer.
/// </summary>
public interface IAnalyticsRepository
{
    // ── DORA Four Keys ────────────────────────────────────────────────────────

    /// <summary>
    /// Per-day terminal deployment count (success + failure) in <paramref name="from"/>…<paramref name="to"/>.
    /// Used to compute deployment frequency and CFR KPIs.
    /// </summary>
    Task<IReadOnlyList<DailyTerminalCounts>> GetDailyTerminalCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>
    /// Approximated lead-time samples (hours) from <c>parent_deployments</c> promotion chains
    /// reaching a <c>prod</c> environment within the window.
    /// Returns an empty list when no qualifying chains exist.
    /// </summary>
    Task<IReadOnlyList<double>> GetLeadTimeHourSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>
    /// Time-to-restore samples (minutes) for incidents within the window:
    /// each sample is (<c>restored_at − failed_at</c>) in minutes for resolved failures.
    /// </summary>
    Task<IReadOnlyList<double>> GetMttrMinuteSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    // ── Chart series ──────────────────────────────────────────────────────────

    /// <summary>Deployment duration samples (minutes) per logical deployment (<c>deployment_id</c>).</summary>
    Task<IReadOnlyList<double>> GetDurationMinuteSamplesAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>
    /// Distinct <c>deployment_id</c> counts per funnel stage environment.
    /// Only the five canonical ladder environments are included.
    /// </summary>
    Task<IReadOnlyList<FunnelStageCount>> GetFunnelCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>Event count per <c>status</c> value within the window.</summary>
    Task<IReadOnlyList<StatusCount>> GetStatusCountsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>
    /// Event counts bucketed by UTC day-of-week (0 = Sunday … 6 = Saturday) and hour.
    /// Only non-zero cells are returned.
    /// </summary>
    Task<IReadOnlyList<HeatmapCell>> GetHeatmapCellsAsync(
        DateTimeOffset from, DateTimeOffset to, CancellationToken ct);

    /// <summary>
    /// Deployment counts grouped by actor within the window,
    /// descending by count, limited to <paramref name="limit"/> rows.
    /// Events without an actor are grouped as <c>"unknown"</c>.
    /// </summary>
    Task<IReadOnlyList<DeployerCount>> GetTopDeployersAsync(
        DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct);

    /// <summary>
    /// Restoration incidents within the window, worst-first (longest duration first;
    /// unresolved = null duration sorts first), limited to <paramref name="limit"/> rows.
    /// </summary>
    Task<IReadOnlyList<IncidentRow>> GetIncidentsAsync(
        DateTimeOffset from, DateTimeOffset to, int limit, CancellationToken ct);
}

// ── Intermediate record types returned by queries ─────────────────────────────

/// <summary>Terminal deployment counts for one UTC day.</summary>
public sealed record DailyTerminalCounts(DateOnly Date, int SuccessCount, int FailureCount);

/// <summary>Distinct deployment count for one funnel-stage environment.</summary>
public sealed record FunnelStageCount(string Environment, int Count);

/// <summary>Event count for one status value.</summary>
public sealed record StatusCount(string Status, int Count);

/// <summary>Populated heatmap cell.</summary>
public sealed record HeatmapCell(int DayOfWeek, int Hour, int Count);

/// <summary>Actor's deployment count.</summary>
public sealed record DeployerCount(string Actor, int Count);

/// <summary>One restoration incident row.</summary>
public sealed record IncidentRow(
    string Service,
    string Environment,
    DateTimeOffset FailedAt,
    DateTimeOffset? RestoredAt);
