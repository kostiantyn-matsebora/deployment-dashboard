using Dashboard.Fetcher.Hosting;

namespace Dashboard.Fetcher.Tests.Hosting;

/// <summary>
/// CR-0011 § 3a — pure-function tests for <see cref="RateLimitResolver"/>.
/// Locks the precedence (absolute &gt; percentage), the default-30 rule,
/// and the floor / clamp edge cases. Validation of operator inputs is
/// covered separately by the DI startup-validation tests (it throws on
/// negative / out-of-range values before the resolver ever runs).
/// </summary>
public sealed class RateLimitResolverTests
{
    // ──────────────────────────────────────────────────────────────────────
    // Precedence — absolute wins when set + positive
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_AbsoluteSet_OverridesPercentage()
    {
        var options = new FetcherOptions
        {
            RateLimitAbsolute = 1500,
            RateLimitPercentage = 50, // would compute 2500 — ignored
        };

        var cap = RateLimitResolver.Resolve(options, upstreamLimit: 5000);

        Assert.Equal(1500, cap);
    }

    [Fact]
    public void Resolve_AbsoluteSet_OverridesPercentage_RegardlessOfUpstream()
    {
        var options = new FetcherOptions { RateLimitAbsolute = 100 };

        // Absolute is independent of upstream — same answer for any positive limit.
        Assert.Equal(100, RateLimitResolver.Resolve(options, upstreamLimit: 1));
        Assert.Equal(100, RateLimitResolver.Resolve(options, upstreamLimit: 5000));
        Assert.Equal(100, RateLimitResolver.Resolve(options, upstreamLimit: 1_000_000));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Percentage path
    // ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(5000, 30, 1500)]    // default 30%
    [InlineData(5000, 50, 2500)]
    [InlineData(5000, 1, 50)]       // minimum legal percentage
    [InlineData(5000, 100, 5000)]   // maximum legal percentage = the whole budget
    [InlineData(60, 30, 18)]
    [InlineData(33, 30, 9)]         // 33 * 30 / 100 = 9.9 → floor to 9
    public void Resolve_PercentageSet_AbsoluteUnset_MultipliesAgainstUpstream(int upstreamLimit, int pct, int expected)
    {
        var options = new FetcherOptions { RateLimitPercentage = pct };

        Assert.Equal(expected, RateLimitResolver.Resolve(options, upstreamLimit));
    }

    [Fact]
    public void Resolve_BothUnset_UsesFrameworkDefaultPercentage_30()
    {
        var options = new FetcherOptions(); // both null

        // Default 30% of 5000 = 1500 per CR-0011 § 3a default.
        Assert.Equal(1500, RateLimitResolver.Resolve(options, upstreamLimit: 5000));
        Assert.Equal(30, RateLimitResolver.DefaultPercentage);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Floor / clamp behaviour
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_PercentageOfTinyUpstream_FloorRoundsToAtLeastOne()
    {
        // 1% of 10 = 0.1 → floors to 0 raw, but the resolver clamps to 1
        // so the gate never indefinitely skips ALL requests when the
        // operator opted into governance.
        var options = new FetcherOptions { RateLimitPercentage = 1 };

        Assert.Equal(1, RateLimitResolver.Resolve(options, upstreamLimit: 10));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    public void Resolve_NonPositiveUpstream_ReturnsZero_NotGating(int upstreamLimit)
    {
        // "We don't know the budget yet" — gate stays inert until a real
        // observation arrives. (The worker uses cap <= 0 as the
        // "don't gate" signal.)
        var options = new FetcherOptions { RateLimitPercentage = 30 };

        Assert.Equal(0, RateLimitResolver.Resolve(options, upstreamLimit));
    }

    [Fact]
    public void Resolve_LargeUpstream_DoesNotOverflow()
    {
        // long arithmetic protects against int overflow at int.MaxValue *
        // 100. Big-but-realistic upstream still resolves cleanly.
        var options = new FetcherOptions { RateLimitPercentage = 75 };

        Assert.Equal(750_000, RateLimitResolver.Resolve(options, upstreamLimit: 1_000_000));
    }

    [Fact]
    public void Resolve_AbsoluteZero_FallsThroughToPercentagePath()
    {
        // Validation forbids absolute = 0 at startup, but the resolver is
        // defensive: only positive absolute wins, otherwise the
        // percentage path runs.
        var options = new FetcherOptions
        {
            RateLimitAbsolute = 0,
            RateLimitPercentage = 30,
        };

        Assert.Equal(1500, RateLimitResolver.Resolve(options, upstreamLimit: 5000));
    }

    [Fact]
    public void Resolve_AbsoluteNegative_FallsThroughToPercentagePath()
    {
        // Same defence-in-depth as the zero case.
        var options = new FetcherOptions
        {
            RateLimitAbsolute = -100,
            RateLimitPercentage = 30,
        };

        Assert.Equal(1500, RateLimitResolver.Resolve(options, upstreamLimit: 5000));
    }

    // ──────────────────────────────────────────────────────────────────────
    // IsAbsoluteMode — same precedence as Resolve, surfaced as a bool
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void IsAbsoluteMode_AbsoluteSetAndPositive_True()
    {
        var options = new FetcherOptions { RateLimitAbsolute = 1 };
        Assert.True(RateLimitResolver.IsAbsoluteMode(options));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    [InlineData(-1)]
    public void IsAbsoluteMode_AbsoluteNullOrNonPositive_False(int? abs)
    {
        var options = new FetcherOptions { RateLimitAbsolute = abs };
        Assert.False(RateLimitResolver.IsAbsoluteMode(options));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Argument validation
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_NullOptions_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => RateLimitResolver.Resolve(null!, upstreamLimit: 5000));
    }

    [Fact]
    public void IsAbsoluteMode_NullOptions_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => RateLimitResolver.IsAbsoluteMode(null!));
    }
}
