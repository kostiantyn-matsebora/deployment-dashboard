using System.Net;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.RateLimit;

/// <summary>
/// F16 / §5.9 — window rollover: <c>_ownCount</c> resets to 0 exactly once when
/// <c>now &gt;= previousResetAt</c> AND the new response carries a later reset_at.
/// Tests use an injectable clock so time can be advanced deterministically.
/// </summary>
public sealed class RateLimitBudgetRolloverTests
{
    // ── Within one window: count accumulates, no reset ───────────────────────

    [Fact]
    public async Task WithinOneWindow_CountAccumulates_NoReset()
    {
        var fixedNow = DateTimeOffset.UtcNow;
        // reset_at is in the future — window has not expired yet.
        var resetAt = fixedNow.AddSeconds(3600).ToUnixTimeSeconds();

        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => fixedNow);

        for (var i = 0; i < 5; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(resetAt), default);

        Assert.Equal(5, budget.Used);
    }

    // ── Window rollover: own count resets to 0 then counts the new window ────

    [Fact]
    public async Task WindowRollover_OwnCountResetsToZeroThenCountsNewWindow()
    {
        var epoch = new DateTimeOffset(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

        // Window 1 ends at epoch+3600.
        var window1End = epoch.AddSeconds(3600);
        // Window 2 ends at epoch+7200.
        var window2End = epoch.AddSeconds(7200);

        // Clock is fixed at "epoch" during window 1 calls.
        var now = epoch;
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => now);

        // Three requests in window 1 (clock still at epoch, window hasn't expired).
        for (var i = 0; i < 3; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(window1End.ToUnixTimeSeconds()), default);

        Assert.Equal(3, budget.Used);

        // Advance clock past window 1's reset_at — the window has now expired.
        now = window1End.AddSeconds(1);

        // First request of window 2: response carries a new later reset_at.
        // Rollover condition: now(epoch+3601) >= _resetAt(epoch+3600) AND newResetAt(epoch+7200) > _resetAt.
        await budget.RecordAndWaitIfNeededAsync(MakeResponse(window2End.ToUnixTimeSeconds()), default);

        // Counter must have reset to 0 then incremented to 1 — NOT accumulated to 4.
        Assert.Equal(1, budget.Used);
    }

    // ── Rollover does NOT accumulate across window boundary ──────────────────

    [Fact]
    public async Task WindowRollover_DoesNotAccumulateAcrossBoundary()
    {
        var epoch = new DateTimeOffset(2025, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var window1End = epoch.AddSeconds(3600);
        var window2End = epoch.AddSeconds(7200);

        var now = epoch;
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => now);

        // 10 requests in window 1.
        for (var i = 0; i < 10; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(window1End.ToUnixTimeSeconds()), default);

        Assert.Equal(10, budget.Used);

        // Advance clock to start of window 2.
        now = window1End.AddSeconds(5);

        // 3 more requests in window 2.
        for (var i = 0; i < 3; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(window2End.ToUnixTimeSeconds()), default);

        // Must be 3 (new window), not 13 (accumulated).
        Assert.Equal(3, budget.Used);
    }

    // ── No rollover when clock has not yet passed the previous reset_at ──────

    [Fact]
    public async Task NoRollover_WhenClockHasNotPassedPreviousResetAt()
    {
        var epoch = new DateTimeOffset(2025, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var window1End = epoch.AddSeconds(3600);
        var window2End = epoch.AddSeconds(7200);

        var now = epoch;
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => now);

        // 5 requests in window 1 (clock at epoch, window1End is in the future).
        for (var i = 0; i < 5; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(window1End.ToUnixTimeSeconds()), default);

        Assert.Equal(5, budget.Used);

        // Advance clock to BEFORE window1End — window has not expired.
        now = window1End.AddSeconds(-1);

        // Response carries a different reset_at (window2End) but clock hasn't passed window1End yet.
        await budget.RecordAndWaitIfNeededAsync(MakeResponse(window2End.ToUnixTimeSeconds()), default);

        // Counter must NOT reset — clock hasn't passed the old reset_at.
        Assert.Equal(6, budget.Used);
    }

    // ── Snapshot after rollover carries reset own_used ───────────────────────

    [Fact]
    public async Task SnapshotAfterRollover_ReportsResetOwnUsed()
    {
        var epoch = new DateTimeOffset(2025, 6, 15, 0, 0, 0, TimeSpan.Zero);
        var window1End = epoch.AddSeconds(3600);
        var window2End = epoch.AddSeconds(7200);

        var now = epoch;
        var budget = await MakeBudget(totalLimit: 1000, budgetPct: 100, utcNow: () => now);

        // 7 requests in window 1.
        for (var i = 0; i < 7; i++)
            await budget.RecordAndWaitIfNeededAsync(MakeResponse(window1End.ToUnixTimeSeconds()), default);

        // Advance past window 1 expiry.
        now = window1End.AddSeconds(2);

        // First request of window 2 triggers rollover.
        await budget.RecordAndWaitIfNeededAsync(MakeResponse(window2End.ToUnixTimeSeconds()), default);

        // Budget.Used (== snapshot.own_used) must reflect only the new window (1 request).
        Assert.Equal(1, budget.Used);
        // ResetAt must point to window 2.
        Assert.Equal(window2End, budget.ResetAt);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static async Task<RateLimitBudget> MakeBudget(
        int totalLimit,
        int budgetPct,
        Func<DateTimeOffset>? utcNow = null)
    {
        using var http = new HttpClient(new ThrowingHandler())
        {
            BaseAddress = new Uri("https://api.github.com"),
        };
        return await RateLimitBudget.CreateAsync(
            http, configuredLimit: totalLimit, budgetPct: budgetPct,
            NullLogger<RateLimitBudget>.Instance, default, utcNow);
    }

    private static HttpResponseMessage MakeResponse(long resetEpoch)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK);
        r.Headers.Add("X-RateLimit-Limit", "1000");
        r.Headers.Add("X-RateLimit-Remaining", "999");
        r.Headers.Add("X-RateLimit-Reset", resetEpoch.ToString());
        return r;
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Should not make HTTP requests");
    }
}
