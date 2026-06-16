namespace Dashboard.Read.Analytics;

/// <summary>
/// Pure functions that classify DORA metric values into performance bands and
/// compute trend deltas and sparkline series. No I/O — fully testable in isolation.
/// </summary>
internal static class DoraClassifier
{
    // ── Classification thresholds (DORA 2023 report) ──────────────────────────

    // Deployment frequency (deployments/day)
    private const double FreqEliteMin = 1.0;   // ≥ 1/day
    private const double FreqHighMin = 1.0 / 7;  // ≥ 1/week
    private const double FreqMedMin = 1.0 / 30;  // ≥ 1/month

    // Lead time (hours)
    private const double LtEliteMax = 24.0;
    private const double LtHighMax = 7 * 24.0;
    private const double LtMedMax = 6 * 30 * 24.0;

    // Change-failure rate (ratio 0–1)
    private const double CfrEliteMax = 0.15;
    private const double CfrHighMax = 0.30;

    // MTTR (minutes)
    private const double MttrEliteMax = 60.0;
    private const double MttrHighMax = 24 * 60.0;
    private const double MttrMedMax = 7 * 24 * 60.0;

    // ── Classification ────────────────────────────────────────────────────────

    internal static AnalyticsClassification ClassifyFrequency(double? deployPerDay) =>
        deployPerDay switch
        {
            null => AnalyticsClassification.Low,
            >= FreqEliteMin => AnalyticsClassification.Elite,
            >= FreqHighMin => AnalyticsClassification.High,
            >= FreqMedMin => AnalyticsClassification.Medium,
            _ => AnalyticsClassification.Low,
        };

    internal static AnalyticsClassification ClassifyLeadTime(double? hours) =>
        hours switch
        {
            null => AnalyticsClassification.Low,
            <= LtEliteMax => AnalyticsClassification.Elite,
            <= LtHighMax => AnalyticsClassification.High,
            <= LtMedMax => AnalyticsClassification.Medium,
            _ => AnalyticsClassification.Low,
        };

    internal static AnalyticsClassification ClassifyChangeFailureRate(double? ratio) =>
        ratio switch
        {
            null => AnalyticsClassification.Elite, // no failures = elite
            <= CfrEliteMax => AnalyticsClassification.Elite,
            <= CfrHighMax => AnalyticsClassification.High,
            < 1.0 => AnalyticsClassification.Medium,
            _ => AnalyticsClassification.Low,
        };

    internal static AnalyticsClassification ClassifyMttr(double? minutes) =>
        minutes switch
        {
            null => AnalyticsClassification.Elite, // no incidents = elite
            <= MttrEliteMax => AnalyticsClassification.Elite,
            <= MttrHighMax => AnalyticsClassification.High,
            <= MttrMedMax => AnalyticsClassification.Medium,
            _ => AnalyticsClassification.Low,
        };

    // ── Trend delta ───────────────────────────────────────────────────────────

    /// <summary>
    /// Signed fractional change of <paramref name="current"/> versus <paramref name="prior"/>.
    /// Returns <c>null</c> when either value is null or prior is zero (no comparable baseline).
    /// </summary>
    internal static double? TrendDelta(double? current, double? prior) =>
        current is null || prior is null || prior == 0.0
            ? null
            : (current.Value - prior.Value) / prior.Value;

    // ── Sparkline helpers ─────────────────────────────────────────────────────

    /// <summary>
    /// Builds a per-day sparkline over <paramref name="days"/> from <paramref name="dailyCounts"/>.
    /// Each element is the sum of terminal events for that day (success + failure).
    /// </summary>
    internal static IReadOnlyList<double> FrequencySparkline(
        IReadOnlyList<DailyTerminalCounts> dailyCounts, DateOnly windowStart, int days)
    {
        var map = dailyCounts.ToDictionary(b => b.Date, b => (double)(b.SuccessCount + b.FailureCount));
        return Enumerable.Range(0, days)
            .Select(i => map.GetValueOrDefault(windowStart.AddDays(i), 0.0))
            .ToList();
    }

    /// <summary>
    /// Builds a per-day sparkline of the change-failure rate.
    /// Zero when the day has no terminal events.
    /// </summary>
    internal static IReadOnlyList<double> CfrSparkline(
        IReadOnlyList<DailyTerminalCounts> dailyCounts, DateOnly windowStart, int days)
    {
        var map = dailyCounts.ToDictionary(b => b.Date);
        return Enumerable.Range(0, days)
            .Select(i =>
            {
                if (!map.TryGetValue(windowStart.AddDays(i), out var b)) return 0.0;
                var total = b.SuccessCount + b.FailureCount;
                return total == 0 ? 0.0 : (double)b.FailureCount / total;
            })
            .ToList();
    }

    // ── Aggregate helpers ─────────────────────────────────────────────────────

    /// <summary>Average deployment frequency (deployments/day) over the window.</summary>
    internal static double? DeploymentFrequency(IReadOnlyList<DailyTerminalCounts> counts, int days)
    {
        if (days <= 0) return null;
        var total = counts.Sum(b => b.SuccessCount + b.FailureCount);
        return (double)total / days;
    }

    /// <summary>Overall change-failure rate over the window (null when no terminal events).</summary>
    internal static double? ChangeFailureRate(IReadOnlyList<DailyTerminalCounts> counts)
    {
        var total = counts.Sum(b => b.SuccessCount + b.FailureCount);
        if (total == 0) return null;
        var failures = counts.Sum(b => b.FailureCount);
        return (double)failures / total;
    }

    /// <summary>Median of a sorted sample list; null when empty.</summary>
    internal static double? Median(IReadOnlyList<double> samples)
    {
        if (samples.Count == 0) return null;
        var sorted = samples.OrderBy(v => v).ToList();
        var mid = sorted.Count / 2;
        return sorted.Count % 2 == 0
            ? (sorted[mid - 1] + sorted[mid]) / 2.0
            : sorted[mid];
    }

    /// <summary>p95 of a sample list; null when empty.</summary>
    internal static double? Percentile95(IReadOnlyList<double> samples)
    {
        if (samples.Count == 0) return null;
        var sorted = samples.OrderBy(v => v).ToList();
        var idx = (int)Math.Ceiling(0.95 * sorted.Count) - 1;
        return sorted[Math.Clamp(idx, 0, sorted.Count - 1)];
    }

    /// <summary>
    /// Splits a time-ordered sample list at the half-window boundary.
    /// The first <c>Count/2</c> samples (earlier) form the prior half;
    /// the remainder form the current half. Mirrors <see cref="FrequencyHalfWindows"/>
    /// for KPIs whose repository returns samples ordered by <c>happened_at</c>.
    /// </summary>
    internal static (double? Current, double? Prior) SampleHalfWindows(
        IReadOnlyList<double> samples)
    {
        if (samples.Count == 0) return (null, null);
        var half = samples.Count / 2;
        var prior = samples.Take(half).ToList();
        var current = samples.Skip(half).ToList();
        return (Median(current), Median(prior));
    }

    /// <summary>
    /// Splits the daily counts into current (latter half) and prior (first half) sub-windows
    /// and returns the deployment frequency for each half, enabling trend_delta computation.
    /// </summary>
    internal static (double? Current, double? Prior) FrequencyHalfWindows(
        IReadOnlyList<DailyTerminalCounts> counts, DateOnly windowStart, int totalDays)
    {
        var halfDays = totalDays / 2;
        var halfStart = windowStart.AddDays(halfDays);

        var prior = counts.Where(b => b.Date < halfStart).ToList();
        var current = counts.Where(b => b.Date >= halfStart).ToList();

        var priorFreq = halfDays > 0
            ? (double)prior.Sum(b => b.SuccessCount + b.FailureCount) / halfDays
            : null as double?;

        var currentDays = totalDays - halfDays;
        var currentFreq = currentDays > 0
            ? (double)current.Sum(b => b.SuccessCount + b.FailureCount) / currentDays
            : null as double?;

        return (currentFreq, priorFreq);
    }
}
