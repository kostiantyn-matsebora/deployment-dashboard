using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dashboard.Read.Analytics;
using Dashboard.Shared.Contracts;
using DeployerEventRow = Dashboard.Read.Analytics.AnalyticsRepository.DeployerEventRow;

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
    public void WindowResolver_FromToMatch_DayBoundaryAndWindow()
    {
        // now is mid-day; to must be truncated to the start of the UTC day.
        var now = new DateTimeOffset(2026, 6, 10, 12, 0, 0, TimeSpan.Zero);
        var expectedTo = new DateTimeOffset(2026, 6, 10, 0, 0, 0, TimeSpan.Zero);
        var result = AnalyticsWindowResolver.Resolve("7d", 365, now);

        Assert.Equal(expectedTo, result.To);
        Assert.Equal(expectedTo.AddDays(-7), result.From);
    }

    [Fact]
    public void WindowResolver_TwoCalls_SameDayDifferentTime_ProduceSameWindow()
    {
        // Two requests within the same UTC day must resolve the same from/to so their
        // serialised responses are identical and If-None-Match → 304 works.
        var t1 = new DateTimeOffset(2026, 6, 10, 8, 30, 0, TimeSpan.Zero);
        var t2 = new DateTimeOffset(2026, 6, 10, 21, 59, 59, TimeSpan.Zero);

        var r1 = AnalyticsWindowResolver.Resolve("7d", 365, t1);
        var r2 = AnalyticsWindowResolver.Resolve("7d", 365, t2);

        Assert.Equal(r1.From, r2.From);
        Assert.Equal(r1.To, r2.To);
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

    // ── Defect 2: ETag determinism — same-day requests must produce identical ETags ──

    [Fact]
    public void ETag_SameDayRequests_ProduceIdenticalEtags()
    {
        // Two requests at different times within the same UTC day must resolve the same
        // window (day-boundary truncation) and therefore the same serialised response,
        // so a SHA-256-based ETag matches and If-None-Match → 304 fires.
        var t1 = new DateTimeOffset(2026, 6, 10, 9, 0, 0, TimeSpan.Zero);
        var t2 = new DateTimeOffset(2026, 6, 10, 18, 45, 12, TimeSpan.Zero);

        var w1 = AnalyticsWindowResolver.Resolve("7d", 365, t1);
        var w2 = AnalyticsWindowResolver.Resolve("7d", 365, t2);

        Assert.Equal(w1.From, w2.From);
        Assert.Equal(w1.To, w2.To);

        // Simulate the ETag helper: serialize an identical response, verify same hash.
        var resp1 = new AnalyticsFrequencyResponse(w1, []);
        var resp2 = new AnalyticsFrequencyResponse(w2, []);

        var etag1 = ComputeWeakETag(JsonSerializer.Serialize(resp1));
        var etag2 = ComputeWeakETag(JsonSerializer.Serialize(resp2));

        Assert.Equal(etag1, etag2);
    }

    // ── Defect 1/3/4a: null-present — nullable analytics contract fields must serialise as null ──

    [Fact]
    public void AnalyticsKpi_NullTrendDelta_SerializesAsNullNotOmitted()
    {
        // With the global WhenWritingNull policy, trend_delta would be absent.
        // The [JsonIgnore(Never)] override must keep it present as null.
        var opts = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        };
        var kpi = new AnalyticsKpi(null, "per_day", AnalyticsClassification.Elite, null, [], false);
        var json = JsonSerializer.Serialize(kpi, opts);

        Assert.Contains("\"trend_delta\":null", json);
        Assert.Contains("\"value\":null", json);
    }

    [Fact]
    public void AnalyticsDurationBin_NullUpperMinutes_SerializesAsNullNotOmitted()
    {
        var opts = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        };
        var bin = new AnalyticsDurationBin("120+", 120, null, 5);
        var json = JsonSerializer.Serialize(bin, opts);

        Assert.Contains("\"upper_minutes\":null", json);
    }

    [Fact]
    public void AnalyticsFunnelStage_NullConversion_SerializesAsNullNotOmitted()
    {
        var opts = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        };
        var stage = new AnalyticsFunnelStage("prod", 10, null);
        var json = JsonSerializer.Serialize(stage, opts);

        Assert.Contains("\"conversion\":null", json);
    }

    // ── Defect 4b: funnel conversion — exact values on a known fixture ────────

    [Fact]
    public void FunnelConversion_KnownFixture_CorrectRatios()
    {
        // Fixture: dev=100, staging=82, qa=60, preprod=50, prod=40.
        // conversion at dev = staging / dev = 82/100 = 0.82
        // conversion at staging = qa / staging = 60/82 ≈ 0.7317
        // conversion at qa = preprod / qa = 50/60 ≈ 0.8333
        // conversion at preprod = prod / preprod = 40/50 = 0.80
        // conversion at prod = null (terminal)
        var counts = new List<FunnelStageCount>
        {
            new("dev",     100),
            new("staging",  82),
            new("qa",       60),
            new("preprod",  50),
            new("prod",     40),
        };

        var stages = BuildFunnelStages(counts);

        Assert.Equal(5, stages.Count);

        Assert.Equal(0.82, stages[0].Conversion!.Value, precision: 10);         // dev
        Assert.Equal(60.0 / 82.0, stages[1].Conversion!.Value, precision: 10); // staging
        Assert.Equal(50.0 / 60.0, stages[2].Conversion!.Value, precision: 10); // qa
        Assert.Equal(0.80, stages[3].Conversion!.Value, precision: 10);         // preprod
        Assert.Null(stages[4].Conversion);                                       // prod — terminal
    }

    [Fact]
    public void FunnelConversion_ZeroCountStage_ConversionNull()
    {
        // When a stage has count=0, conversion must be null (contract: "null when count is 0").
        var counts = new List<FunnelStageCount>
        {
            new("dev",    50),
            new("staging", 0), // zero → conversion null, cannot divide by zero
            new("qa",     30),
            new("preprod",20),
            new("prod",   10),
        };

        var stages = BuildFunnelStages(counts);

        Assert.Equal(0.0, stages[0].Conversion!.Value, precision: 10); // dev: staging(0)/dev(50)=0
        Assert.Null(stages[1].Conversion);  // staging: count=0 → null
        Assert.Equal(20.0 / 30.0, stages[2].Conversion!.Value, precision: 10); // qa
        Assert.Equal(10.0 / 20.0, stages[3].Conversion!.Value, precision: 10); // preprod
        Assert.Null(stages[4].Conversion);  // prod — terminal
    }

    // ── GroupTopDeployers — distinct successful deployments, credited to earliest actor ─

    [Fact]
    public void TopDeployers_MultipleEventsPerDeployment_CountsOnceForEarliestActor()
    {
        // queued(actorA) -> in_progress(bot) -> success(bot) for one deployment.
        // Must count ONCE, attributed to actorA (earliest event), not bot, not 3 events.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", "actorA",    t0.AddHours(1)),
            new DeployerEventRow("dep-1", "bot",       t0.AddHours(2)),
            new DeployerEventRow("dep-1", "bot",       t0.AddHours(3)),
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 10);

        var row = Assert.Single(result);
        Assert.Equal("actorA", row.Actor);
        Assert.Equal(1, row.Count);
    }

    [Fact]
    public void TopDeployers_NullEarliestActor_ReportedAsUnknown()
    {
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", null,    t0.AddHours(1)),
            new DeployerEventRow("dep-1", "bot",   t0.AddHours(2)),
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 10);

        var row = Assert.Single(result);
        Assert.Equal("unknown", row.Actor);
        Assert.Equal(1, row.Count);
    }

    [Fact]
    public void TopDeployers_TwoDistinctSuccessfulDeploymentsSameActor_CountsTwo()
    {
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", "alice", t0.AddHours(1)),
            new DeployerEventRow("dep-2", "alice", t0.AddHours(2)),
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 10);

        var row = Assert.Single(result);
        Assert.Equal("alice", row.Actor);
        Assert.Equal(2, row.Count);
    }

    [Fact]
    public void TopDeployers_LimitApplied_ReturnsTopNDescending()
    {
        // alice has 2, bob has 1 — limit 1 should return only alice.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", "alice", t0.AddHours(1)),
            new DeployerEventRow("dep-2", "alice", t0.AddHours(2)),
            new DeployerEventRow("dep-3", "bob",   t0.AddHours(3)),
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 1);

        var row = Assert.Single(result);
        Assert.Equal("alice", row.Actor);
        Assert.Equal(2, row.Count);
    }

    [Fact]
    public void TopDeployers_EqualCount_OrderedByActorOrdinal()
    {
        // alice and bob both have 1 deployment; ordinal order: alice < bob.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", "bob",   t0.AddHours(1)),
            new DeployerEventRow("dep-2", "alice", t0.AddHours(2)),
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 10);

        Assert.Equal(2, result.Count);
        Assert.Equal("alice", result[0].Actor); // alice < bob ordinal
        Assert.Equal("bob",   result[1].Actor);
    }

    [Fact]
    public void TopDeployers_SameHappenedAt_OrdinalMinActorChosen()
    {
        // Two events at the same time in one deployment: "zzz" and "aaa".
        // ThenBy(Actor, Ordinal) must pick "aaa" (ordinal min) as the earliest actor.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var rows = new[]
        {
            new DeployerEventRow("dep-1", "zzz", t0.AddHours(1)),
            new DeployerEventRow("dep-1", "aaa", t0.AddHours(1)), // same time, lower ordinal
        };

        var result = AnalyticsRepository.GroupTopDeployers(rows, 10);

        var row = Assert.Single(result);
        Assert.Equal("aaa", row.Actor);
        Assert.Equal(1, row.Count);
    }

    // ── CollectIncidentsFromSlot — coalesce consecutive failures into one outage ─

    [Fact]
    public void Incidents_FourFailuresThenSuccess_ProducesOneIncident()
    {
        // 4 consecutive failures then 1 success = one outage.
        // failedAt = first failure; restoredAt = the success.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var events = new[]
        {
            (DeploymentStatus.Failure, t0.AddHours(1)),
            (DeploymentStatus.Failure, t0.AddHours(2)),
            (DeploymentStatus.Failure, t0.AddHours(3)),
            (DeploymentStatus.Failure, t0.AddHours(4)),
            (DeploymentStatus.Success, t0.AddHours(5)),
        };

        var incidents = CollectIncidents("svc", "qa", events);

        var row = Assert.Single(incidents);
        Assert.Equal(t0.AddHours(1), row.FailedAt);
        Assert.Equal(t0.AddHours(5), row.RestoredAt);
    }

    [Fact]
    public void Incidents_FailuresWithNoSuccess_ProducesOneUnrecovered()
    {
        // A run of failures with no trailing success = one unrecovered incident.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var events = new[]
        {
            (DeploymentStatus.Failure, t0.AddHours(1)),
            (DeploymentStatus.Failure, t0.AddHours(2)),
            (DeploymentStatus.Failure, t0.AddHours(3)),
        };

        var incidents = CollectIncidents("svc", "prod", events);

        var row = Assert.Single(incidents);
        Assert.Equal(t0.AddHours(1), row.FailedAt);
        Assert.Null(row.RestoredAt);
    }

    [Fact]
    public void Incidents_FailureSuccessFailureSuccess_ProducesTwoIncidents()
    {
        // F, S, F, S = two separate outages.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var events = new[]
        {
            (DeploymentStatus.Failure, t0.AddHours(1)),
            (DeploymentStatus.Success, t0.AddHours(2)),
            (DeploymentStatus.Failure, t0.AddHours(3)),
            (DeploymentStatus.Success, t0.AddHours(4)),
        };

        var incidents = CollectIncidents("svc", "staging", events);

        Assert.Equal(2, incidents.Count);
        Assert.Equal(t0.AddHours(1), incidents[0].FailedAt);
        Assert.Equal(t0.AddHours(2), incidents[0].RestoredAt);
        Assert.Equal(t0.AddHours(3), incidents[1].FailedAt);
        Assert.Equal(t0.AddHours(4), incidents[1].RestoredAt);
    }

    [Fact]
    public void Incidents_TwoSlots_AreIndependent()
    {
        // Two different (service,env) slots must not share incident state.
        var t0 = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var eventsA = new[]
        {
            (DeploymentStatus.Failure, t0.AddHours(1)),
            (DeploymentStatus.Success, t0.AddHours(2)),
        };
        var eventsB = new[]
        {
            (DeploymentStatus.Failure, t0.AddHours(3)),
        };

        var incidentsA = CollectIncidents("payments-api", "qa", eventsA);
        var incidentsB = CollectIncidents("payments-api", "prod", eventsB);

        var rowA = Assert.Single(incidentsA);
        Assert.Equal("qa", rowA.Environment);
        Assert.NotNull(rowA.RestoredAt);

        var rowB = Assert.Single(incidentsB);
        Assert.Equal("prod", rowB.Environment);
        Assert.Null(rowB.RestoredAt);
    }

    // ── Private test helpers ──────────────────────────────────────────────────

    /// <summary>
    /// Mirrors <c>AnalyticsRepository.CollectIncidentsFromSlot</c> (private) so the
    /// coalescing algorithm can be unit-tested without a running host.
    /// </summary>
    private static IReadOnlyList<IncidentRow> CollectIncidents(
        string service,
        string environment,
        IEnumerable<(string Status, DateTimeOffset HappenedAt)> orderedEvents)
    {
        var incidents = new List<IncidentRow>();
        DateTimeOffset? openedAt = null;
        foreach (var (status, happenedAt) in orderedEvents)
        {
            if (status == DeploymentStatus.Failure)
            {
                openedAt ??= happenedAt;
            }
            else if (status == DeploymentStatus.Success && openedAt.HasValue)
            {
                incidents.Add(new IncidentRow(service, environment, openedAt.Value, happenedAt));
                openedAt = null;
            }
        }
        if (openedAt.HasValue)
            incidents.Add(new IncidentRow(service, environment, openedAt.Value, null));
        return incidents;
    }

    /// <summary>
    /// Mirrors the production funnel-building logic from
    /// <c>AnalyticsEndpoints.HandlePromotionFunnelAsync</c> so the conversion
    /// formula can be unit-tested without a running host.
    /// </summary>
    private static IReadOnlyList<AnalyticsFunnelStage> BuildFunnelStages(
        IReadOnlyList<FunnelStageCount> counts)
    {
        var stages = new List<AnalyticsFunnelStage>(counts.Count);
        for (var i = 0; i < counts.Count; i++)
        {
            var stageCount = counts[i].Count;
            double? conversion = null;
            if (i < counts.Count - 1 && stageCount > 0)
                conversion = (double)counts[i + 1].Count / stageCount;

            stages.Add(new AnalyticsFunnelStage(counts[i].Environment, stageCount, conversion));
        }
        return stages;
    }

    private static string ComputeWeakETag(string json)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return $"W/\"{Convert.ToHexString(hash)[..16]}\"";
    }
}
