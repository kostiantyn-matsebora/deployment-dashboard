using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Contracts;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Read.Analytics;

// S1200: An endpoint-mapping surface class necessarily references every route handler,
// response DTO, repository, and config type — coupling is inherent and irreducible.
[SuppressMessage("SonarAnalyzer", "S1200", Justification = "Endpoint-mapping surface: coupling to all handler dependencies is inherent and irreducible.")]

/// <summary>
/// Maps the nine focused analytics <c>GET</c> reads under <c>/api/analytics/*</c>.
/// All endpoints:
/// <list type="bullet">
///   <item>Accept <c>?window=7d|14d|30d</c> (default 7d) — clamped server-side to <c>HISTORY_RETENTION_DAYS</c>.</item>
///   <item>Return a weak ETag and honour <c>If-None-Match → 304</c>.</item>
///   <item>Are unauthenticated (internal-only, same trust tier as other reads).</item>
/// </list>
/// </summary>
public static class AnalyticsEndpoints
{
    private const double EliteThreshold = 0.15;

    private static readonly int[] DurationBinBoundaries = [0, 10, 20, 30, 60, 120];

    // OpenAPI Status enum declaration order (pending, queued, waiting, in-progress, success, failure, cancelled, rejected).
    private static readonly IReadOnlyList<string> StatusEnumOrder =
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

    public static IEndpointRouteBuilder MapAnalyticsEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/analytics/dora", HandleDoraAsync)
           .WithName("GetAnalyticsDora")
           .WithTags("analytics")
           .WithSummary("DORA Four Keys KPI band")
           .Produces<AnalyticsDoraResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/frequency", HandleFrequencyAsync)
           .WithName("GetAnalyticsFrequency")
           .WithTags("analytics")
           .WithSummary("Deployment frequency over time")
           .Produces<AnalyticsFrequencyResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/change-failure-rate", HandleChangeFailureRateAsync)
           .WithName("GetAnalyticsChangeFailureRate")
           .WithTags("analytics")
           .WithSummary("Change-failure-rate trend")
           .Produces<AnalyticsChangeFailureRateResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/duration-histogram", HandleDurationHistogramAsync)
           .WithName("GetAnalyticsDurationHistogram")
           .WithTags("analytics")
           .WithSummary("Deployment-duration distribution")
           .Produces<AnalyticsDurationHistogramResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/promotion-funnel", HandlePromotionFunnelAsync)
           .WithName("GetAnalyticsPromotionFunnel")
           .WithTags("analytics")
           .WithSummary("Promotion funnel per-stage counts + conversion")
           .Produces<AnalyticsPromotionFunnelResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/status-distribution", HandleStatusDistributionAsync)
           .WithName("GetAnalyticsStatusDistribution")
           .WithTags("analytics")
           .WithSummary("Status distribution over all 8 statuses")
           .Produces<AnalyticsStatusDistributionResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/heatmap", HandleHeatmapAsync)
           .WithName("GetAnalyticsHeatmap")
           .WithTags("analytics")
           .WithSummary("Deploy heatmap — day-of-week × hour")
           .Produces<AnalyticsHeatmapResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/top-deployers", HandleTopDeployersAsync)
           .WithName("GetAnalyticsTopDeployers")
           .WithTags("analytics")
           .WithSummary("Top deployers — actor + deployment count")
           .Produces<AnalyticsTopDeployersResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/analytics/incidents", HandleIncidentsAsync)
           .WithName("GetAnalyticsIncidents")
           .WithTags("analytics")
           .WithSummary("Time-to-restore incidents — worst-first")
           .Produces<AnalyticsIncidentsResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        return app;
    }

    // ── Handlers ─────────────────────────────────────────────────────────────

    private static async Task<IResult> HandleDoraAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);

        var dailyCounts = await repo.GetDailyTerminalCountsAsync(win.From, win.To, ct);
        var ltSamples = await repo.GetLeadTimeHourSamplesAsync(win.From, win.To, ct);
        var mttrSamples = await repo.GetMttrMinuteSamplesAsync(win.From, win.To, ct);

        // Deployment frequency
        var freq = DoraClassifier.DeploymentFrequency(dailyCounts, win.Days);
        var (freqCurrent, freqPrior) = DoraClassifier.FrequencyHalfWindows(
            dailyCounts, DateOnly.FromDateTime(win.From.UtcDateTime.Date), win.Days);
        var freqSparkline = DoraClassifier.FrequencySparkline(
            dailyCounts, DateOnly.FromDateTime(win.From.UtcDateTime.Date), win.Days);

        // CFR
        var cfr = DoraClassifier.ChangeFailureRate(dailyCounts);
        var cfrSparkline = DoraClassifier.CfrSparkline(
            dailyCounts, DateOnly.FromDateTime(win.From.UtcDateTime.Date), win.Days);

        // Lead time — samples are ordered by happened_at from the repository.
        var lt = DoraClassifier.Median(ltSamples);
        var (ltCurrent, ltPrior) = DoraClassifier.SampleHalfWindows(ltSamples);

        // MTTR — samples are ordered by failed_at from the repository.
        var mttr = DoraClassifier.Median(mttrSamples);
        var (mttrCurrent, mttrPrior) = DoraClassifier.SampleHalfWindows(mttrSamples);

        var response = new AnalyticsDoraResponse(
            Window: win,
            DeploymentFrequency: new AnalyticsKpi(
                Value: freq,
                Unit: "per_day",
                Classification: DoraClassifier.ClassifyFrequency(freq),
                TrendDelta: DoraClassifier.TrendDelta(freqCurrent, freqPrior),
                Sparkline: freqSparkline,
                Approximated: false),
            LeadTime: new AnalyticsKpi(
                Value: lt,
                Unit: "hours",
                Classification: DoraClassifier.ClassifyLeadTime(lt),
                TrendDelta: DoraClassifier.TrendDelta(ltCurrent, ltPrior),
                Sparkline: [],
                Approximated: true),
            ChangeFailureRate: new AnalyticsKpi(
                Value: cfr,
                Unit: "ratio",
                Classification: DoraClassifier.ClassifyChangeFailureRate(cfr),
                TrendDelta: null, // per-day CFR trend not per-half; null acceptable
                Sparkline: cfrSparkline,
                Approximated: false),
            TimeToRestore: new AnalyticsKpi(
                Value: mttr,
                Unit: "minutes",
                Classification: DoraClassifier.ClassifyMttr(mttr),
                TrendDelta: DoraClassifier.TrendDelta(mttrCurrent, mttrPrior),
                Sparkline: [],
                Approximated: false));

        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleFrequencyAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var dailyCounts = await repo.GetDailyTerminalCountsAsync(win.From, win.To, ct);

        // Zero-fill all days in the window.
        var map = dailyCounts.ToDictionary(b => b.Date);
        var start = DateOnly.FromDateTime(win.From.UtcDateTime.Date);
        var buckets = Enumerable.Range(0, win.Days)
            .Select(i =>
            {
                var date = start.AddDays(i);
                return map.TryGetValue(date, out var b)
                    ? new AnalyticsFrequencyBucket(date, b.SuccessCount, b.FailureCount)
                    : new AnalyticsFrequencyBucket(date, 0, 0);
            })
            .ToList();

        var response = new AnalyticsFrequencyResponse(win, buckets);
        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleChangeFailureRateAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var dailyCounts = await repo.GetDailyTerminalCountsAsync(win.From, win.To, ct);

        var start = DateOnly.FromDateTime(win.From.UtcDateTime.Date);
        var map = dailyCounts.ToDictionary(b => b.Date);
        var buckets = Enumerable.Range(0, win.Days)
            .Select(i =>
            {
                var date = start.AddDays(i);
                if (!map.TryGetValue(date, out var b)) return new AnalyticsCfrBucket(date, 0.0);
                var total = b.SuccessCount + b.FailureCount;
                return new AnalyticsCfrBucket(date, total == 0 ? 0.0 : (double)b.FailureCount / total);
            })
            .ToList();

        var response = new AnalyticsChangeFailureRateResponse(win, EliteThreshold, buckets);
        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleDurationHistogramAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var samples = await repo.GetDurationMinuteSamplesAsync(win.From, win.To, ct);

        var bins = BuildDurationBins(samples);
        var response = new AnalyticsDurationHistogramResponse(
            win, bins,
            DoraClassifier.Median(samples),
            DoraClassifier.Percentile95(samples));

        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandlePromotionFunnelAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var counts = await repo.GetFunnelCountsAsync(win.From, win.To, ct);

        var stages = new List<AnalyticsFunnelStage>(counts.Count);
        for (var i = 0; i < counts.Count; i++)
        {
            var stageCount = counts[i].Count;
            double? conversion = null;
            if (i < counts.Count - 1 && stageCount > 0)
                conversion = (double)counts[i + 1].Count / stageCount;

            stages.Add(new AnalyticsFunnelStage(counts[i].Environment, stageCount, conversion));
        }

        var response = new AnalyticsPromotionFunnelResponse(win, stages);
        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleStatusDistributionAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var counts = await repo.GetStatusCountsAsync(win.From, win.To, ct);

        var map = counts.ToDictionary(r => r.Status, r => r.Count);

        // All eight statuses in OpenAPI enum declaration order, zero-filled.
        var statuses = StatusEnumOrder
            .Select(s => new AnalyticsStatusCount(s, map.GetValueOrDefault(s, 0)))
            .ToList();

        var response = new AnalyticsStatusDistributionResponse(win, statuses);
        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleHeatmapAsync(
        [FromQuery] string? window,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var cells = await repo.GetHeatmapCellsAsync(win.From, win.To, ct);

        var response = new AnalyticsHeatmapResponse(
            win,
            cells.Select(c => new AnalyticsHeatmapCell(c.DayOfWeek, c.Hour, c.Count)).ToList());

        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleTopDeployersAsync(
        [FromQuery] string? window,
        [FromQuery] int? limit,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var effectiveLimit = Math.Clamp(limit ?? 10, 1, 100);
        var deployers = await repo.GetTopDeployersAsync(win.From, win.To, effectiveLimit, ct);

        var response = new AnalyticsTopDeployersResponse(
            win,
            deployers.Select(d => new AnalyticsDeployer(d.Actor, d.Count)).ToList());

        return ETagResult(response, ifNoneMatch, httpContext);
    }

    private static async Task<IResult> HandleIncidentsAsync(
        [FromQuery] string? window,
        [FromQuery] int? limit,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IAnalyticsRepository repo,
        IConfiguration configuration,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var win = ResolveWindow(window, configuration);
        var effectiveLimit = Math.Clamp(limit ?? 10, 1, 100);
        var rows = await repo.GetIncidentsAsync(win.From, win.To, effectiveLimit, ct);

        var incidents = rows.Select(r =>
        {
            var duration = r.RestoredAt.HasValue
                ? (double?)(r.RestoredAt.Value - r.FailedAt).TotalMinutes
                : null;
            return new AnalyticsIncident(
                r.Service, r.Environment, r.FailedAt, r.RestoredAt, duration,
                ClassifyIncidentSeverity(duration));
        }).ToList();

        var response = new AnalyticsIncidentsResponse(win, incidents);
        return ETagResult(response, ifNoneMatch, httpContext);
    }

    // ── Shared helpers ────────────────────────────────────────────────────────

    /// <summary>Resolves the window param and clamps to configured retention.</summary>
    private static AnalyticsWindow ResolveWindow(string? window, IConfiguration configuration)
    {
        var rawRetention = configuration["HISTORY_RETENTION_DAYS"];
        var retention = int.TryParse(rawRetention, out var r) && r >= 90 ? r : 365;
        return AnalyticsWindowResolver.Resolve(window, retention, DateTimeOffset.UtcNow);
    }

    /// <summary>
    /// Serialises <paramref name="response"/>, computes a weak ETag, emits it on the response,
    /// and short-circuits with <c>304</c> when <paramref name="ifNoneMatch"/> matches.
    /// </summary>
    private static IResult ETagResult<T>(T response, string? ifNoneMatch, HttpContext httpContext)
    {
        var json = JsonSerializer.Serialize(response);
        var etag = ComputeWeakETag(json);
        httpContext.Response.Headers.ETag = etag;

        if (ifNoneMatch is not null && ifNoneMatch == etag)
            return Results.StatusCode(StatusCodes.Status304NotModified);

        return Results.Ok(response);
    }

    private static string ComputeWeakETag(string json)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(json));
        return $"W/\"{Convert.ToHexString(hash)[..16]}\"";
    }

    /// <summary>
    /// Assigns an incident severity from its resolved <paramref name="durationMinutes"/>.
    /// Unresolved (null) → Critical; then by duration bracket.
    /// </summary>
    private static AnalyticsSeverity ClassifyIncidentSeverity(double? durationMinutes) =>
        durationMinutes switch
        {
            null => AnalyticsSeverity.Critical,
            <= 60 => AnalyticsSeverity.Low,
            <= 4 * 60 => AnalyticsSeverity.Medium,
            <= 24 * 60 => AnalyticsSeverity.High,
            _ => AnalyticsSeverity.Critical,
        };

    // ── Duration histogram ────────────────────────────────────────────────────

    private static IReadOnlyList<AnalyticsDurationBin> BuildDurationBins(
        IReadOnlyList<double> samples)
    {
        var bins = new List<AnalyticsDurationBin>();

        // Fixed bin boundaries: [0,10), [10,20), [20,30), [30,60), [60,120), [120,∞)
        for (var i = 0; i < DurationBinBoundaries.Length; i++)
        {
            var lower = DurationBinBoundaries[i];
            int? upper = i < DurationBinBoundaries.Length - 1
                ? DurationBinBoundaries[i + 1]
                : null;

            var label = upper.HasValue ? $"{lower}-{upper}" : $"{lower}+";
            var count = upper.HasValue
                ? samples.Count(s => s >= lower && s < upper.Value)
                : samples.Count(s => s >= lower);

            bins.Add(new AnalyticsDurationBin(label, lower, upper, count));
        }

        return bins;
    }
}
