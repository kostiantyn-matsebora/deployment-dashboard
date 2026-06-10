using System.Text.Json.Serialization;

namespace Dashboard.Read.Analytics;

// ── Shared window ─────────────────────────────────────────────────────────────

/// <summary>
/// The window the server resolved for an analytics aggregate.
/// Every <c>/api/analytics/*</c> response embeds this so the SPA can label
/// the period and flag when retention narrowed the request.
/// </summary>
public sealed record AnalyticsWindow(
    int Days,
    DateTimeOffset From,
    DateTimeOffset To,
    int RetentionDays,
    bool Clamped);

// ── DORA ──────────────────────────────────────────────────────────────────────

/// <summary>DORA performance band — elite / high / medium / low.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<AnalyticsClassification>))]
public enum AnalyticsClassification
{
    Elite,
    High,
    Medium,
    Low,
}

/// <summary>One DORA key — value, unit, performance band, trend, and sparkline.</summary>
public sealed record AnalyticsKpi(
    double? Value,
    string Unit,
    AnalyticsClassification Classification,
    double? TrendDelta,
    IReadOnlyList<double> Sparkline,
    bool Approximated);

/// <summary>DORA Four Keys KPI band response.</summary>
public sealed record AnalyticsDoraResponse(
    AnalyticsWindow Window,
    AnalyticsKpi DeploymentFrequency,
    AnalyticsKpi LeadTime,
    AnalyticsKpi ChangeFailureRate,
    AnalyticsKpi TimeToRestore);

// ── Frequency ─────────────────────────────────────────────────────────────────

/// <summary>One UTC-day bucket of terminal deployment counts.</summary>
public sealed record AnalyticsFrequencyBucket(
    DateOnly Date,
    int Success,
    int Failure);

/// <summary>Per-day success/failure deployment counts.</summary>
public sealed record AnalyticsFrequencyResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsFrequencyBucket> Buckets);

// ── Change-Failure Rate ───────────────────────────────────────────────────────

/// <summary>One UTC-day bucket of the change-failure rate.</summary>
public sealed record AnalyticsCfrBucket(
    DateOnly Date,
    double Rate);

/// <summary>Per-day CFR trend plus the elite reference line.</summary>
public sealed record AnalyticsChangeFailureRateResponse(
    AnalyticsWindow Window,
    double EliteThreshold,
    IReadOnlyList<AnalyticsCfrBucket> Buckets);

// ── Duration Histogram ────────────────────────────────────────────────────────

/// <summary>One histogram bin of deployment durations (minutes).</summary>
public sealed record AnalyticsDurationBin(
    string Label,
    int LowerMinutes,
    int? UpperMinutes,
    int Count);

/// <summary>Duration distribution (bins + percentiles).</summary>
public sealed record AnalyticsDurationHistogramResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsDurationBin> Bins,
    double? P50Minutes,
    double? P95Minutes);

// ── Promotion Funnel ──────────────────────────────────────────────────────────

/// <summary>One stage of the promotion funnel.</summary>
public sealed record AnalyticsFunnelStage(
    string Environment,
    int Count,
    double? Conversion);

/// <summary>Promotion funnel dev → staging → qa → preprod → prod.</summary>
public sealed record AnalyticsPromotionFunnelResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsFunnelStage> Stages);

// ── Status Distribution ───────────────────────────────────────────────────────

/// <summary>Event count for one status value.</summary>
public sealed record AnalyticsStatusCount(
    string Status,
    int Count);

/// <summary>Event count per status — all 8 statuses, zero-filled.</summary>
public sealed record AnalyticsStatusDistributionResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsStatusCount> Statuses);

// ── Heatmap ───────────────────────────────────────────────────────────────────

/// <summary>One populated day-of-week × hour cell.</summary>
public sealed record AnalyticsHeatmapCell(
    int DayOfWeek,
    int Hour,
    int Count);

/// <summary>Day-of-week × hour deployment counts. Sparse — only non-zero cells returned.</summary>
public sealed record AnalyticsHeatmapResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsHeatmapCell> Cells);

// ── Top Deployers ─────────────────────────────────────────────────────────────

/// <summary>One actor's deployment count.</summary>
public sealed record AnalyticsDeployer(
    string Actor,
    int Count);

/// <summary>Deployment counts grouped by actor, highest-first.</summary>
public sealed record AnalyticsTopDeployersResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsDeployer> Deployers);

// ── Incidents ─────────────────────────────────────────────────────────────────

/// <summary>
/// Severity band derived from <c>duration_minutes</c>.
/// Unresolved (<c>null</c> duration) → <c>Critical</c>.
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter<AnalyticsSeverity>))]
public enum AnalyticsSeverity
{
    Low,
    Medium,
    High,
    Critical,
}

/// <summary>One restoration incident — a failure later restored in the same slot.</summary>
public sealed record AnalyticsIncident(
    string Service,
    string Environment,
    DateTimeOffset FailedAt,
    DateTimeOffset? RestoredAt,
    double? DurationMinutes,
    AnalyticsSeverity Severity);

/// <summary>Worst-first restoration incidents.</summary>
public sealed record AnalyticsIncidentsResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsIncident> Incidents);
