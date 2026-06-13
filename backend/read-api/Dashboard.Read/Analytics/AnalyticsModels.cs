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
    [JsonStringEnumMemberName("elite")]
    Elite,
    [JsonStringEnumMemberName("high")]
    High,
    [JsonStringEnumMemberName("medium")]
    Medium,
    [JsonStringEnumMemberName("low")]
    Low,
}

/// <summary>One DORA key — value, unit, performance band, trend, and sparkline.</summary>
/// <remarks>
/// <c>Value</c> and <c>TrendDelta</c> are nullable contract fields that must serialize as
/// explicit <c>null</c> even when the global JSON policy omits nulls — hence the
/// <see cref="JsonIgnoreCondition.Never"/> override on each.
/// </remarks>
public sealed record AnalyticsKpi(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? Value,
    string Unit,
    AnalyticsClassification Classification,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? TrendDelta,
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
/// <remarks>
/// <c>UpperMinutes</c> is <c>null</c> for the open-ended top bin and must serialize as
/// explicit <c>null</c> per contract.
/// </remarks>
public sealed record AnalyticsDurationBin(
    string Label,
    int LowerMinutes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? UpperMinutes,
    int Count);

/// <summary>Duration distribution (bins + percentiles).</summary>
/// <remarks>
/// <c>P50Minutes</c> and <c>P95Minutes</c> are nullable contract fields that must
/// serialize as explicit <c>null</c> when no measurable deployments exist.
/// </remarks>
public sealed record AnalyticsDurationHistogramResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsDurationBin> Bins,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? P50Minutes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? P95Minutes);

// ── Promotion Funnel ──────────────────────────────────────────────────────────

/// <summary>One stage of the promotion funnel.</summary>
/// <remarks>
/// <c>Conversion</c> is <c>null</c> for the terminal stage and must serialize as
/// explicit <c>null</c> per contract.
/// </remarks>
public sealed record AnalyticsFunnelStage(
    string Environment,
    int Count,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? Conversion);

/// <summary>
/// Promotion funnel stages in operator-configured order
/// (<c>ANALYTICS_FUNNEL_ENVIRONMENTS</c>, default dev → staging → qa → preprod → prod).
/// The last stage is the production terminal that lead-time measures to.
/// </summary>
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
    [JsonStringEnumMemberName("low")]
    Low,
    [JsonStringEnumMemberName("medium")]
    Medium,
    [JsonStringEnumMemberName("high")]
    High,
    [JsonStringEnumMemberName("critical")]
    Critical,
}

/// <summary>One restoration incident — a failure later restored in the same slot.</summary>
/// <remarks>
/// <c>RestoredAt</c> and <c>DurationMinutes</c> are nullable contract fields that must
/// serialize as explicit <c>null</c> for unresolved incidents.
/// </remarks>
public sealed record AnalyticsIncident(
    string Service,
    string Environment,
    DateTimeOffset FailedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTimeOffset? RestoredAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] double? DurationMinutes,
    AnalyticsSeverity Severity);

/// <summary>Worst-first restoration incidents.</summary>
public sealed record AnalyticsIncidentsResponse(
    AnalyticsWindow Window,
    IReadOnlyList<AnalyticsIncident> Incidents);
