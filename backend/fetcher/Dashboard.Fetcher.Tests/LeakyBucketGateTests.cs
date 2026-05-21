using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Hosting;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// CR-0011 acceptance criterion (a/b/c/d/e) + ADR-0008 Decision 1 — the
/// leaky-bucket gate. Pure function of three numbers (and one timestamp):
///
/// <code>
/// skip-this-request := (upstream_limit - upstream_remaining) ≥ SelfImposedCap
///                      AND now &lt; upstream_reset_at
/// </code>
///
/// <para>The host (<see cref="FetcherWorker"/>) consults this gate before
/// invoking <see cref="ICiCdAdapter.FetchPageAsync"/> on each
/// <c>(adapter, source-id)</c>. The cap comes from
/// <see cref="RateLimitResolver.Resolve(FetcherOptions, int)"/>; the
/// <c>(upstream_limit, upstream_remaining, upstream_reset_at)</c> triple
/// comes from the latest <see cref="FetchPage.RateLimit"/> observation.</para>
///
/// <para>Per ADR-0008 Decision 1 the gate holds NO fetcher-side state —
/// the upstream's <c>X-RateLimit-Remaining</c> is the single source of
/// truth. Restart-safety contract: "kill at any time, restart, resume
/// from cursor + last response" is preserved because no internal counter
/// exists to lose.</para>
/// </summary>
public sealed class LeakyBucketGateTests
{
    // ──────────────────────────────────────────────────────────────────────
    // 1. Cap NOT reached → tick issues requests (gate returns "do-not-skip")
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Gate_CapNotReached_ReturnsDoNotSkip()
    {
        var now = DateTime.UtcNow;
        var observation = new RateLimitObservation(
            UpstreamLimit: 5000,
            UpstreamRemaining: 4500,       // used = 500
            UpstreamResetAt: now.AddMinutes(30),
            ObservedAt: now.AddSeconds(-10));
        const int selfImposedCap = 1500;

        var skip = LeakyBucketGate.ShouldSkip(observation, selfImposedCap, now);

        Assert.False(skip,
            "upstream_used=500 < cap=1500 → tick must proceed.");
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. Cap reached mid-window → tick skips (used ≥ cap AND now < reset)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Gate_CapReachedMidWindow_ReturnsSkip()
    {
        var now = DateTime.UtcNow;
        var observation = new RateLimitObservation(
            UpstreamLimit: 5000,
            UpstreamRemaining: 3500,       // used = 1500 == cap
            UpstreamResetAt: now.AddMinutes(15),
            ObservedAt: now.AddSeconds(-5));
        const int selfImposedCap = 1500;

        var skip = LeakyBucketGate.ShouldSkip(observation, selfImposedCap, now);

        Assert.True(skip,
            "upstream_used=1500 ≥ cap=1500 AND now < reset_at → tick must skip.");
    }

    [Fact]
    public void Gate_CapExceededMidWindow_ReturnsSkip()
    {
        var now = DateTime.UtcNow;
        var observation = new RateLimitObservation(
            UpstreamLimit: 5000,
            UpstreamRemaining: 2000,       // used = 3000 > cap
            UpstreamResetAt: now.AddMinutes(15),
            ObservedAt: now.AddSeconds(-5));
        const int selfImposedCap = 1500;

        var skip = LeakyBucketGate.ShouldSkip(observation, selfImposedCap, now);

        Assert.True(skip);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. AT/PAST reset → tick resumes (window rolled over upstream-side)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Gate_AtOrPastResetTime_EvenWhenCapWasReached_ReturnsDoNotSkip()
    {
        var now = DateTime.UtcNow;
        var observation = new RateLimitObservation(
            UpstreamLimit: 5000,
            UpstreamRemaining: 0,          // used == cap (cap reached)
            UpstreamResetAt: now.AddSeconds(-1), // BUT reset is in the past
            ObservedAt: now.AddMinutes(-31));
        const int selfImposedCap = 1500;

        var skip = LeakyBucketGate.ShouldSkip(observation, selfImposedCap, now);

        Assert.False(skip,
            "Even with used ≥ cap, now ≥ reset_at means the upstream window has rolled — gate must release.");
    }

    // ──────────────────────────────────────────────────────────────────────
    // 4. Precedence — absolute wins over percentage
    //    (Resolver test; the gate consumes a resolved cap as a pre-computed input)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolver_AbsoluteWinsOverPercentage_WhenBothSet()
    {
        var options = new FetcherOptions
        {
            WriteApiUrl = "http://test/",
            WriteApiKey = "k",
            AdapterIds = Array.Empty<string>(),
            RateLimitAbsolute = 200,      // explicit absolute
            RateLimitPercentage = 50,     // would resolve to 2500 on a 5000 limit
        };

        var cap = RateLimitResolver.Resolve(options, upstreamLimit: 5000);

        // Absolute wins per CR-0011 § 3a + ADR-0008 § Decision-not-applicable
        // (precedence is a CR-level lock).
        Assert.Equal(200, cap);
        Assert.True(RateLimitResolver.IsAbsoluteMode(options),
            "When RateLimitAbsolute > 0, IsAbsoluteMode must report true so the startup log line states the correct mode.");
    }

    // ──────────────────────────────────────────────────────────────────────
    // 5. Default 30% when both null (resolver fallback)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolver_BothNull_FallsBackToDefault30Percent()
    {
        var options = new FetcherOptions
        {
            WriteApiUrl = "http://test/",
            WriteApiKey = "k",
            AdapterIds = Array.Empty<string>(),
            RateLimitAbsolute = null,
            RateLimitPercentage = null,
        };

        var cap = RateLimitResolver.Resolve(options, upstreamLimit: 5000);

        Assert.Equal(1500, cap); // 30% of 5000 — CR-0011 § 3a "default 30"
        Assert.False(RateLimitResolver.IsAbsoluteMode(options));
        Assert.Equal(30, RateLimitResolver.DefaultPercentage);
    }
}

/// <summary>
/// Pure-function gate per ADR-0008 Decision 1. The implementation owned by
/// <c>Dashboard.Fetcher.Hosting</c> — this stub declares the shape the
/// host must provide so the test file compiles when the BE lands the
/// real impl. If the BE chooses a different surface (e.g. an instance
/// method on FetcherWorker or a private nested type), the production
/// type with the same signature should sit in
/// <c>Dashboard.Fetcher.Hosting.LeakyBucketGate</c> and the stub below
/// will collide → BE removes the stub.
///
/// <para>This stub is INTENTIONALLY MARKED INTERNAL to the test assembly
/// so the BE impl replaces it cleanly on land.</para>
/// </summary>
internal static class LeakyBucketGate
{
    /// <summary>
    /// Returns <c>true</c> when the gate should skip the next request.
    /// Per ADR-0008 Decision 1:
    /// <c>skip := upstream_used &gt;= cap AND now &lt; reset_at</c>.
    /// </summary>
    public static bool ShouldSkip(
        RateLimitObservation observation,
        int selfImposedCap,
        DateTime now)
    {
        ArgumentNullException.ThrowIfNull(observation);
        if (selfImposedCap <= 0) return false; // no cap → never skip
        var upstreamUsed = observation.UpstreamLimit - observation.UpstreamRemaining;
        var windowStillActive = now < observation.UpstreamResetAt;
        return upstreamUsed >= selfImposedCap && windowStillActive;
    }
}
