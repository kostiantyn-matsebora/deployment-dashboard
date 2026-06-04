using System.Net;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.RateLimit;

/// <summary>
/// F18 / §5.11 — <c>RateLimitBudget</c> captures <c>X-RateLimit-Limit</c> /
/// <c>X-RateLimit-Remaining</c> from GitHub responses and exposes them as
/// <c>CiLimit</c> / <c>CiRemaining</c> for the per-cycle rate-limit snapshot.
/// </summary>
public sealed class RateLimitSnapshotHeaderTests
{
    // ── CiLimit / CiRemaining null before first response ────────────────────

    [Fact]
    public async Task CiLimit_And_CiRemaining_NullBeforeFirstResponse()
    {
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        Assert.Null(budget.CiLimit);
        Assert.Null(budget.CiRemaining);
    }

    // ── CiLimit / CiRemaining populated from headers ─────────────────────────

    [Fact]
    public async Task CiLimit_PopulatedFromXRateLimitLimitHeader()
    {
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        var response = MakeResponse(limit: 5000, remaining: 4800, resetEpoch: FutureEpoch());
        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Equal(5000, budget.CiLimit);
    }

    [Fact]
    public async Task CiRemaining_PopulatedFromXRateLimitRemainingHeader()
    {
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        var response = MakeResponse(limit: 5000, remaining: 3210, resetEpoch: FutureEpoch());
        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Equal(3210, budget.CiRemaining);
    }

    [Fact]
    public async Task CiLimit_And_CiRemaining_UpdatedOnSubsequentResponses()
    {
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100);

        // First response
        await budget.RecordAndWaitIfNeededAsync(
            MakeResponse(limit: 5000, remaining: 4999, resetEpoch: FutureEpoch()), default);

        Assert.Equal(5000, budget.CiLimit);
        Assert.Equal(4999, budget.CiRemaining);

        // Second response with different remaining
        await budget.RecordAndWaitIfNeededAsync(
            MakeResponse(limit: 5000, remaining: 4900, resetEpoch: FutureEpoch()), default);

        Assert.Equal(5000, budget.CiLimit);
        Assert.Equal(4900, budget.CiRemaining);
    }

    [Fact]
    public async Task CiLimit_And_CiRemaining_NullWhenHeadersAbsent()
    {
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        // Response with no X-RateLimit-* headers (except Reset, which is needed for rollover logic)
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        response.Headers.Add("X-RateLimit-Reset", FutureEpoch().ToString());
        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Null(budget.CiLimit);
        Assert.Null(budget.CiRemaining);
    }

    // ── 304 still populates CiLimit / CiRemaining ───────────────────────────

    [Fact]
    public async Task CiLimit_And_CiRemaining_PopulatedFrom304Response()
    {
        // Header capture is unconditional — 304 responses still carry Limit/Remaining headers
        // and those values must update the snapshot (§5.5.2 / F16).
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 30);

        var response = new HttpResponseMessage(HttpStatusCode.NotModified);
        response.Headers.Add("X-RateLimit-Limit", "5000");
        response.Headers.Add("X-RateLimit-Remaining", "4750");
        response.Headers.Add("X-RateLimit-Reset", FutureEpoch().ToString());
        await budget.RecordAndWaitIfNeededAsync(response, default);

        Assert.Equal(5000, budget.CiLimit);
        Assert.Equal(4750, budget.CiRemaining);

        // own_used must NOT be incremented.
        Assert.Equal(0, budget.Used);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static async Task<RateLimitBudget> MakeBudget(int totalLimit, int budgetPct)
    {
        using var http = new HttpClient(new ThrowingHandler())
        {
            BaseAddress = new Uri("https://api.github.com"),
        };
        return await RateLimitBudget.CreateAsync(
            http, configuredLimit: totalLimit, budgetPct: budgetPct,
            NullLogger<RateLimitBudget>.Instance, default);
    }

    private static HttpResponseMessage MakeResponse(int limit, int remaining, long resetEpoch)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK);
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
