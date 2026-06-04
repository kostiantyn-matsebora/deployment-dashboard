using System.Net;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.RateLimit;

/// <summary>
/// Tests for F3: rate-limit budget tracks the fetcher's OWN request count since process
/// start, NOT the externally-reported <c>X-RateLimit-Used</c> header value.
/// </summary>
public sealed class RateLimitOwnUsageTests
{
    // ── F3: high external X-RateLimit-Used → no pause ───────────────────────

    [Fact]
    public async Task HighExternalUsed_LowOwnCount_NoPause()
    {
        // budget = floor(1000 × 30 / 100) = 300
        // External X-RateLimit-Used = 900 (token almost exhausted by other consumers).
        // Fetcher's own count = 1 (just made one call).
        // Must NOT pause — only own count matters.
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        // Response reports high external usage (900 used, 100 remaining).
        var response = MakeResponse(
            externalUsed: 900,
            limit: 1000,
            remaining: 100,
            resetEpoch: FutureEpoch());

        var sw = System.Diagnostics.Stopwatch.StartNew();
        await budget.RecordAndWaitIfNeededAsync(response, default);
        sw.Stop();

        // Must complete immediately — own count (1) is well below budget (300).
        Assert.True(sw.ElapsedMilliseconds < 500,
            $"Should not pause when own count is low; elapsed={sw.ElapsedMilliseconds}ms");
        Assert.Equal(1, budget.Used);
    }

    // ── F3: own count >= budget → pause until reset_at ───────────────────────

    [Fact]
    public async Task OwnCountReachesBudget_PausesUntilReset()
    {
        // budget = floor(100 × 10 / 100) = 10
        // Make 9 calls below budget, then the 10th hits the limit.
        var budget = await MakeBudget(totalLimit: 100, budgetPct: 10);

        var resetEpoch = DateTimeOffset.UtcNow.AddMilliseconds(200).ToUnixTimeSeconds();

        // Simulate 9 calls below budget.
        for (var i = 0; i < 9; i++)
        {
            var preResponse = MakeResponse(
                externalUsed: 50, limit: 100, remaining: 50, resetEpoch: resetEpoch);
            await budget.RecordAndWaitIfNeededAsync(preResponse, default);
        }

        Assert.Equal(9, budget.Used);

        // 10th call hits the budget.
        var finalResponse = MakeResponse(
            externalUsed: 50, limit: 100, remaining: 50, resetEpoch: resetEpoch);

        var sw = System.Diagnostics.Stopwatch.StartNew();
        await budget.RecordAndWaitIfNeededAsync(finalResponse, default);
        sw.Stop();

        // Should have paused until reset_at + 1 s. With a 200ms reset window the
        // total delay should be positive (not negligible).
        Assert.True(sw.ElapsedMilliseconds > 50,
            $"Should pause when own count reaches budget; elapsed={sw.ElapsedMilliseconds}ms");

        // After the pause, own count must be reset to 0.
        Assert.Equal(0, budget.Used);
    }

    // ── F3: 304 Not Modified does NOT increment own count ────────────────────

    [Fact]
    public async Task OwnCount_NotIncremented_For304Response()
    {
        // 304 consumes no GitHub quota; own_used must stay at 0 after a 304 call (§5.5.2 / F16).
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100);

        var response = new System.Net.Http.HttpResponseMessage(System.Net.HttpStatusCode.NotModified);
        response.Headers.Add("X-RateLimit-Reset", FutureEpoch().ToString());

        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Equal(0, budget.Used);
    }

    [Fact]
    public async Task OwnCount_Incremented_For200Response()
    {
        // Non-304 (200 OK) is quota-consuming; own_used must increment to 1 (§5.5.2 / F16).
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100);

        var response = MakeResponse(externalUsed: 1, limit: 1000, remaining: 999, resetEpoch: FutureEpoch());
        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Equal(1, budget.Used);
    }

    // ── F3: own count increments per call, not from external header ──────────

    [Fact]
    public async Task OwnCount_IncrementsPerCall_IgnoresExternalUsedHeader()
    {
        // budget = 1000 (effectively unlimited for this test)
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100);

        // Three calls, each reporting external used = 999 (near limit).
        for (var i = 0; i < 3; i++)
        {
            var response = MakeResponse(
                externalUsed: 999, limit: 1000, remaining: 1, resetEpoch: FutureEpoch());
            await budget.RecordAndWaitIfNeededAsync(response, default);
        }

        // Own count should be 3 (one per call), not 999 (external value).
        Assert.Equal(3, budget.Used);
    }

    // ── F3: window rollover resets own count ─────────────────────────────────

    [Fact]
    public async Task WindowRollover_ResetsOwnCount()
    {
        // Window 1: reset_at is 1 s in the past (the old window has already expired).
        // The injected clock is fixed so rollover detection is deterministic.
        var fixedNow = DateTimeOffset.UtcNow;
        var window1ResetAt = fixedNow.AddSeconds(-1);
        var window2ResetAt = fixedNow.AddSeconds(3600);

        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => fixedNow);

        // Three calls inside window 1.
        for (var i = 0; i < 3; i++)
        {
            await budget.RecordAndWaitIfNeededAsync(
                MakeResponse(externalUsed: 10, limit: 1000, remaining: 990,
                             resetEpoch: window1ResetAt.ToUnixTimeSeconds()), default);
        }

        Assert.Equal(3, budget.Used);

        // First call of window 2: now >= window1ResetAt AND new reset_at > window1ResetAt
        // → own counter must reset to 0 then increment to 1.
        await budget.RecordAndWaitIfNeededAsync(
            MakeResponse(externalUsed: 0, limit: 1000, remaining: 1000,
                         resetEpoch: window2ResetAt.ToUnixTimeSeconds()), default);

        Assert.Equal(1, budget.Used);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static async Task<RateLimitBudget> MakeBudget(
        int totalLimit, int budgetPct, Func<DateTimeOffset>? utcNow = null)
    {
        using var http = new HttpClient(new ThrowingHandler())
        {
            BaseAddress = new Uri("https://api.github.com"),
        };
        return await RateLimitBudget.CreateAsync(
            http, configuredLimit: totalLimit, budgetPct: budgetPct,
            NullLogger<RateLimitBudget>.Instance, default, utcNow);
    }

    private static HttpResponseMessage MakeResponse(
        int externalUsed, int limit, int remaining, long resetEpoch)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK);
        r.Headers.Add("X-RateLimit-Used", externalUsed.ToString());
        r.Headers.Add("X-RateLimit-Limit", limit.ToString());
        r.Headers.Add("X-RateLimit-Remaining", remaining.ToString());
        r.Headers.Add("X-RateLimit-Reset", resetEpoch.ToString());
        return r;
    }

    private static long FutureEpoch() =>
        DateTimeOffset.UtcNow.AddSeconds(3600).ToUnixTimeSeconds();

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Should not make HTTP requests");
    }
}
