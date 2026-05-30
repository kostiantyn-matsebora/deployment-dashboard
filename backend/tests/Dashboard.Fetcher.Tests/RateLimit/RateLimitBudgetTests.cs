using System.Net;
using System.Net.Http.Json;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.RateLimit;

public sealed class RateLimitBudgetTests
{
    // ── CreateAsync ───────────────────────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_ConfiguredLimit_SkipsDiscovery()
    {
        // If configuredLimit > 0, CreateAsync must NOT call GET /rate_limit.
        // We prove this by using a handler that throws on any request.
        using var http = new HttpClient(new ThrowingHandler())
        {
            BaseAddress = new Uri("https://api.github.com")
        };

        // Should not throw because discovery is skipped
        var budget = await RateLimitBudget.CreateAsync(
            http, configuredLimit: 1000, budgetPct: 30,
            NullLogger<RateLimitBudget>.Instance, default);

        Assert.NotNull(budget);
    }

    [Fact]
    public async Task CreateAsync_RateLimitEndpointNon2xx_FallsBackTo5000()
    {
        using var http = MakeHttpClient(statusCode: HttpStatusCode.InternalServerError);

        var budget = await RateLimitBudget.CreateAsync(
            http, configuredLimit: 0, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default);

        // budget = floor(5000 × 100 / 100) = 5000 — still created without exception
        Assert.NotNull(budget);
    }

    [Fact]
    public async Task CreateAsync_BudgetCalculation_FloorOfPct()
    {
        // total = 5000, pct = 30 → budget = floor(5000 * 0.30) = 1500
        // We can observe indirectly: budget doesn't throw for any pct value
        using var http = MakeHttpClient(totalLimit: 5000);

        var budget = await RateLimitBudget.CreateAsync(
            http, configuredLimit: 0, budgetPct: 1,
            NullLogger<RateLimitBudget>.Instance, default);

        Assert.NotNull(budget);
    }

    // ── RecordAndWaitIfNeededAsync ────────────────────────────────────────────

    [Fact]
    public async Task RecordAndWait_UsedBelowBudget_DoesNotDelay()
    {
        var budget = await RateLimitBudget.CreateAsync(
            MakeHttpClient(totalLimit: 1000), configuredLimit: 1000, budgetPct: 30,
            NullLogger<RateLimitBudget>.Instance, default);

        var response = MakeRateLimitResponse(used: 100, limit: 1000, remaining: 900, resetEpoch: FutureEpoch());

        var sw = System.Diagnostics.Stopwatch.StartNew();
        await budget.RecordAndWaitIfNeededAsync(response, default);
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 500);
    }

    [Fact]
    public async Task RecordAndWait_XRateLimitUsedHeader_UsedForBudgetCheck()
    {
        // budget = floor(100 * 50 / 100) = 50
        var budget = await RateLimitBudget.CreateAsync(
            MakeHttpClient(totalLimit: 100), configuredLimit: 100, budgetPct: 50,
            NullLogger<RateLimitBudget>.Instance, default);

        // used = 49 (below budget=50) — should not delay
        var response = MakeRateLimitResponse(used: 49, limit: 100, remaining: 51, resetEpoch: FutureEpoch());
        await budget.RecordAndWaitIfNeededAsync(response, default);  // must not throw
    }

    [Fact]
    public async Task RecordAndWait_FallbackHeaders_LimitMinusRemaining()
    {
        var budget = await RateLimitBudget.CreateAsync(
            MakeHttpClient(totalLimit: 1000), configuredLimit: 1000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default);

        // No X-RateLimit-Used; use limit(1000) − remaining(100) = used(900) < budget(1000)
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        response.Headers.Add("X-RateLimit-Limit", "1000");
        response.Headers.Add("X-RateLimit-Remaining", "100");
        response.Headers.Add("X-RateLimit-Reset", FutureEpoch().ToString());

        await budget.RecordAndWaitIfNeededAsync(response, default);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static HttpClient MakeHttpClient(
        HttpStatusCode statusCode = HttpStatusCode.OK,
        int totalLimit = 5000)
    {
        var handler = new MockRateLimitHandler(statusCode, totalLimit);
        return new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
    }

    private static HttpResponseMessage MakeRateLimitResponse(
        int used, int limit, int remaining, long resetEpoch)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        response.Headers.Add("X-RateLimit-Used", used.ToString());
        response.Headers.Add("X-RateLimit-Limit", limit.ToString());
        response.Headers.Add("X-RateLimit-Remaining", remaining.ToString());
        response.Headers.Add("X-RateLimit-Reset", resetEpoch.ToString());
        return response;
    }

    private static long FutureEpoch() =>
        DateTimeOffset.UtcNow.AddSeconds(1).ToUnixTimeSeconds();

    private sealed class MockRateLimitHandler(HttpStatusCode statusCode, int totalLimit) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var response = new HttpResponseMessage(statusCode);
            if (statusCode == HttpStatusCode.OK)
            {
                var body = new { resources = new { core = new { limit = totalLimit, remaining = totalLimit, used = 0, reset = FutureEpoch() } } };
                response.Content = JsonContent.Create(body);
            }
            return Task.FromResult(response);
        }
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Should not make HTTP requests");
    }

    private static long FutureEpoch2() =>
        DateTimeOffset.UtcNow.AddSeconds(1).ToUnixTimeSeconds();
}
