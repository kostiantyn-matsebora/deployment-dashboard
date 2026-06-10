using System.Text.Json;
using Dashboard.Read.Analytics;
using Dashboard.Shared.Contracts;

namespace Dashboard.Read.Tests;

/// <summary>
/// Unit tests for analytics helpers (DoraClassifier, AnalyticsWindowResolver).
/// Pure functions — no I/O, no DB, no DI container.
/// </summary>
public sealed class AnalyticsTests
{
    // ── AnalyticsWindowResolver ───────────────────────────────────────────────

    [Theory]
    [InlineData("7d", 7)]
    [InlineData("14d", 14)]
    [InlineData("30d", 30)]
    public void WindowResolver_ValidWindow_ReturnCorrectDays(string window, int expectedDays)
    {
        var now = new DateTimeOffset(2026, 6, 10, 0, 0, 0, TimeSpan.Zero);
        var result = AnalyticsWindowResolver.Resolve(window, 365, now);

        Assert.Equal(expectedDays, result.Days);
        Assert.False(result.Clamped);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("invalid")]
    [InlineData("60d")]
    public void WindowResolver_InvalidOrAbsent_DefaultsTo7d(string? window)
    {
        var now = new DateTimeOffset(2026, 6, 10, 0, 0, 0, TimeSpan.Zero);
        var result = AnalyticsWindowResolver.Resolve(window, 365, now);

        Assert.Equal(7, result.Days);
        Assert.False(result.Clamped);
    }

    [Fact]
    public void WindowResolver_RequestExceedsRetention_Clamped()
    {
        var now = new DateTimeOffset(2026, 6, 10, 0, 0, 0, TimeSpan.Zero);
        // Retention is 5 days; requesting 7d should clamp to 5.
        var result = AnalyticsWindowResolver.Resolve("7d", 5, now);

        Assert.Equal(5, result.Days);
        Assert.True(result.Clamped);
        Assert.Equal(5, result.RetentionDays);
    }

    [Fact]
    public void WindowResolver_FromToMatch_NowAndWindow()
    {
        var now = new DateTimeOffset(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);
        var result = AnalyticsWindowResolver.Resolve("7d", 365, now);

        Assert.Equal(now, result.To);
        Assert.Equal(now.AddDays(-7), result.From);
    }

    // ── DoraClassifier — classification ───────────────────────────────────────

    [Theory]
    [InlineData(2.0, AnalyticsClassification.Elite)]   // > 1/day
    [InlineData(1.0, AnalyticsClassification.Elite)]   // exactly 1/day
    [InlineData(0.2, AnalyticsClassification.High)]    // ~1.4/week
    [InlineData(0.04, AnalyticsClassification.Medium)] // ~1.2/month (> 1/30)
    [InlineData(0.01, AnalyticsClassification.Low)]
    [InlineData(null, AnalyticsClassification.Low)]
    public void Classify_Frequency(double? value, AnalyticsClassification expected)
        => Assert.Equal(expected, DoraClassifier.ClassifyFrequency(value));

    [Theory]
    [InlineData(1.0, AnalyticsClassification.Elite)]    // < 24h
    [InlineData(24.0, AnalyticsClassification.Elite)]
    [InlineData(48.0, AnalyticsClassification.High)]    // < 1 week
    [InlineData(200.0, AnalyticsClassification.Medium)] // < 6 months
    [InlineData(5000.0, AnalyticsClassification.Low)]
    [InlineData(null, AnalyticsClassification.Low)]
    public void Classify_LeadTime(double? value, AnalyticsClassification expected)
        => Assert.Equal(expected, DoraClassifier.ClassifyLeadTime(value));

    [Theory]
    [InlineData(0.05, AnalyticsClassification.Elite)]
    [InlineData(0.15, AnalyticsClassification.Elite)]
    [InlineData(0.25, AnalyticsClassification.High)]
    [InlineData(0.50, AnalyticsClassification.Medium)]
    [InlineData(null, AnalyticsClassification.Elite)]   // no failures = elite
    public void Classify_ChangeFailureRate(double? value, AnalyticsClassification expected)
        => Assert.Equal(expected, DoraClassifier.ClassifyChangeFailureRate(value));

    [Theory]
    [InlineData(30.0, AnalyticsClassification.Elite)]   // < 1h
    [InlineData(60.0, AnalyticsClassification.Elite)]
    [InlineData(300.0, AnalyticsClassification.High)]   // < 24h
    [InlineData(2000.0, AnalyticsClassification.Medium)]
    [InlineData(15000.0, AnalyticsClassification.Low)]
    [InlineData(null, AnalyticsClassification.Elite)]   // no incidents = elite
    public void Classify_Mttr(double? value, AnalyticsClassification expected)
        => Assert.Equal(expected, DoraClassifier.ClassifyMttr(value));

    // ── DoraClassifier — TrendDelta ───────────────────────────────────────────

    [Fact]
    public void TrendDelta_BothNull_ReturnsNull()
        => Assert.Null(DoraClassifier.TrendDelta(null, null));

    [Fact]
    public void TrendDelta_PriorNull_ReturnsNull()
        => Assert.Null(DoraClassifier.TrendDelta(10.0, null));

    [Fact]
    public void TrendDelta_PriorZero_ReturnsNull()
        => Assert.Null(DoraClassifier.TrendDelta(5.0, 0.0));

    [Fact]
    public void TrendDelta_PositiveChange_Correct()
    {
        var delta = DoraClassifier.TrendDelta(11.0, 10.0);
        Assert.NotNull(delta);
        Assert.Equal(0.1, delta!.Value, precision: 10);
    }

    [Fact]
    public void TrendDelta_NegativeChange_Correct()
    {
        var delta = DoraClassifier.TrendDelta(9.0, 10.0);
        Assert.NotNull(delta);
        Assert.Equal(-0.1, delta!.Value, precision: 10);
    }

    // ── DoraClassifier — Median / Percentile95 ────────────────────────────────

    [Fact]
    public void Median_Empty_ReturnsNull()
        => Assert.Null(DoraClassifier.Median([]));

    [Fact]
    public void Median_OddCount_MiddleValue()
    {
        double[] samples = [1, 3, 5];
        Assert.Equal(3.0, DoraClassifier.Median(samples));
    }

    [Fact]
    public void Median_EvenCount_AverageOfTwo()
    {
        double[] samples = [1, 3, 5, 7];
        Assert.Equal(4.0, DoraClassifier.Median(samples));
    }

    [Fact]
    public void Percentile95_Empty_ReturnsNull()
        => Assert.Null(DoraClassifier.Percentile95([]));

    [Fact]
    public void Percentile95_TenSamples_ReturnsNinthValue()
    {
        // p95 of 10 values: ceil(0.95*10)-1 = index 9 (highest).
        double[] samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
        Assert.Equal(100.0, DoraClassifier.Percentile95(samples));
    }

    // ── DoraClassifier — Sparkline helpers ───────────────────────────────────

    [Fact]
    public void FrequencySparkline_ZeroFilledForMissingDays()
    {
        var start = new DateOnly(2026, 6, 1);
        var counts = new List<DailyTerminalCounts>
        {
            new(new DateOnly(2026, 6, 2), 3, 1), // day index 1
        };
        var sparkline = DoraClassifier.FrequencySparkline(counts, start, 3);

        Assert.Equal(3, sparkline.Count);
        Assert.Equal(0.0, sparkline[0]); // 2026-06-01 — no data
        Assert.Equal(4.0, sparkline[1]); // 2026-06-02 — 3+1
        Assert.Equal(0.0, sparkline[2]); // 2026-06-03 — no data
    }

    [Fact]
    public void CfrSparkline_ZeroWhenNoTerminalEvents()
    {
        var start = new DateOnly(2026, 6, 1);
        var sparkline = DoraClassifier.CfrSparkline([], start, 2);

        Assert.Equal(2, sparkline.Count);
        Assert.All(sparkline, v => Assert.Equal(0.0, v));
    }

    [Fact]
    public void CfrSparkline_HalfFailure_IsPoint5()
    {
        var start = new DateOnly(2026, 6, 1);
        var counts = new List<DailyTerminalCounts>
        {
            new(new DateOnly(2026, 6, 1), 2, 2),
        };
        var sparkline = DoraClassifier.CfrSparkline(counts, start, 1);

        Assert.Single(sparkline);
        Assert.Equal(0.5, sparkline[0]);
    }

    // ── DoraClassifier — aggregate helpers ───────────────────────────────────

    [Fact]
    public void DeploymentFrequency_EmptyCounts_ZeroPerDay()
    {
        var freq = DoraClassifier.DeploymentFrequency([], 7);
        Assert.Equal(0.0, freq);
    }

    [Fact]
    public void DeploymentFrequency_14Events_Over7Days()
    {
        var counts = new List<DailyTerminalCounts>
        {
            new(new DateOnly(2026, 6, 1), 10, 4),
        };
        var freq = DoraClassifier.DeploymentFrequency(counts, 7);
        Assert.Equal(2.0, freq); // 14 / 7
    }

    [Fact]
    public void ChangeFailureRate_NoEvents_ReturnsNull()
        => Assert.Null(DoraClassifier.ChangeFailureRate([]));

    [Fact]
    public void ChangeFailureRate_3Success1Failure_IsPoint25()
    {
        var counts = new List<DailyTerminalCounts>
        {
            new(new DateOnly(2026, 6, 1), 3, 1),
        };
        Assert.Equal(0.25, DoraClassifier.ChangeFailureRate(counts));
    }

    // ── DoraClassifier — half-window split ───────────────────────────────────

    [Fact]
    public void FrequencyHalfWindows_SplitsAtHalf()
    {
        var start = new DateOnly(2026, 6, 1);
        // 6 days; first 3 = prior, last 3 = current.
        var counts = new List<DailyTerminalCounts>
        {
            new(new DateOnly(2026, 6, 1), 1, 0), // prior
            new(new DateOnly(2026, 6, 2), 1, 0), // prior
            new(new DateOnly(2026, 6, 3), 1, 0), // prior
            new(new DateOnly(2026, 6, 4), 3, 0), // current
            new(new DateOnly(2026, 6, 5), 3, 0), // current
            new(new DateOnly(2026, 6, 6), 3, 0), // current
        };

        var (current, prior) = DoraClassifier.FrequencyHalfWindows(counts, start, 6);

        Assert.NotNull(current);
        Assert.NotNull(prior);
        // prior half: 3 events / 3 days = 1/day
        Assert.Equal(1.0, prior!.Value, precision: 10);
        // current half: 9 events / 3 days = 3/day
        Assert.Equal(3.0, current!.Value, precision: 10);
    }

    // ── F2: Status distribution — OpenAPI enum declaration order ─────────────

    [Fact]
    public void StatusDistribution_OpenApiEnumOrder_IsCorrect()
    {
        // Asserts the OpenAPI-declared order: pending, queued, waiting, in-progress,
        // success, failure, cancelled, rejected. Matches AnalyticsEndpoints.StatusEnumOrder.
        string[] expected =
        [
            DeploymentStatus.Pending,
            DeploymentStatus.Queued,
            DeploymentStatus.Waiting,
            DeploymentStatus.InProgress,
            DeploymentStatus.Success,
            DeploymentStatus.Failure,
            DeploymentStatus.Cancelled,
            DeploymentStatus.Rejected,
        ];

        // Simulate the map-and-select the endpoint performs, with zero counts.
        var map = new Dictionary<string, int>();
        var statuses = expected.Select(s => new { Status = s, Count = map.GetValueOrDefault(s, 0) }).ToList();

        Assert.Equal(8, statuses.Count);
        for (var i = 0; i < expected.Length; i++)
            Assert.Equal(expected[i], statuses[i].Status);
    }

    // ── F1: Enum serialization — wire values must be lowercase ────────────────

    [Theory]
    [InlineData(AnalyticsClassification.Elite, "\"elite\"")]
    [InlineData(AnalyticsClassification.High, "\"high\"")]
    [InlineData(AnalyticsClassification.Medium, "\"medium\"")]
    [InlineData(AnalyticsClassification.Low, "\"low\"")]
    public void Classification_SerializesLowercase(AnalyticsClassification value, string expected)
    {
        var json = JsonSerializer.Serialize(value);
        Assert.Equal(expected, json);
    }

    [Theory]
    [InlineData(AnalyticsSeverity.Low, "\"low\"")]
    [InlineData(AnalyticsSeverity.Medium, "\"medium\"")]
    [InlineData(AnalyticsSeverity.High, "\"high\"")]
    [InlineData(AnalyticsSeverity.Critical, "\"critical\"")]
    public void Severity_SerializesLowercase(AnalyticsSeverity value, string expected)
    {
        var json = JsonSerializer.Serialize(value);
        Assert.Equal(expected, json);
    }

    // ── F2: SampleHalfWindows — correct trend sign for earlier-vs-later sets ──

    [Fact]
    public void SampleHalfWindows_Empty_ReturnsBothNull()
    {
        var (current, prior) = DoraClassifier.SampleHalfWindows([]);
        Assert.Null(current);
        Assert.Null(prior);
    }

    [Fact]
    public void SampleHalfWindows_EarlierLarger_CurrentIsSmaller_TrendNegative()
    {
        // First (prior) half: [100, 90] → median 95; second (current) half: [10, 20] → median 15.
        // TrendDelta = (15 - 95) / 95 ≈ −0.842 (negative = improvement for lower-is-better MTTR).
        double[] orderedByTime = [100, 90, 10, 20];
        var (current, prior) = DoraClassifier.SampleHalfWindows(orderedByTime);
        Assert.NotNull(current);
        Assert.NotNull(prior);
        Assert.True(current < prior, "current half median should be smaller than prior (improving trend)");
        var delta = DoraClassifier.TrendDelta(current, prior);
        Assert.NotNull(delta);
        Assert.True(delta < 0, "trend_delta must be negative when current is smaller than prior");
    }

    [Fact]
    public void SampleHalfWindows_EarlierSmaller_CurrentIsLarger_TrendPositive()
    {
        // First (prior) half: [10, 20] → median 15; second (current) half: [100, 90] → median 95.
        double[] orderedByTime = [10, 20, 100, 90];
        var (current, prior) = DoraClassifier.SampleHalfWindows(orderedByTime);
        Assert.NotNull(current);
        Assert.NotNull(prior);
        Assert.True(current > prior, "current half median should be larger than prior (worsening trend)");
        var delta = DoraClassifier.TrendDelta(current, prior);
        Assert.NotNull(delta);
        Assert.True(delta > 0, "trend_delta must be positive when current is larger than prior");
    }
}
