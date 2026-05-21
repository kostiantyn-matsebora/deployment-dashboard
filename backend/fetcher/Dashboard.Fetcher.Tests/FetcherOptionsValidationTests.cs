using Dashboard.Fetcher.DependencyInjection;
using Dashboard.Fetcher.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// CR-0011 acceptance criterion (c) — startup validation of the two new
/// rate-limit governance fields on <see cref="FetcherOptions"/>:
/// <c>FETCHER_RATE_LIMIT_ABSOLUTE</c> (must be &gt; 0 when set) +
/// <c>FETCHER_RATE_LIMIT_PERCENTAGE</c> (must be in 1..100 when set; default
/// <see cref="RateLimitResolver.DefaultPercentage"/> = 30 when neither is set).
///
/// <para>The XML-doc on <see cref="FetcherOptions.RateLimitAbsolute"/> +
/// <see cref="FetcherOptions.RateLimitPercentage"/> states: "Startup
/// validation rejects values ≤ 0" / "Startup validation rejects values
/// outside the inclusive 1..100 range." This file is the executable
/// proof of that contract.</para>
///
/// <para>The validation entry point is
/// <see cref="ServiceCollectionExtensions.AddCiCdFetcher"/> — the host's
/// composition root must throw a configuration exception
/// (<see cref="ArgumentException"/> / <see cref="ArgumentOutOfRangeException"/>
/// / <see cref="InvalidOperationException"/>) BEFORE the worker is
/// registered, so a non-conformant env-var binding fails fast at host
/// build time rather than silently producing a degenerate cap.</para>
///
/// <para>These tests run with an empty <c>AdapterIds</c> list so the GHA
/// adapter doesn't pull <c>GHA_TOKEN</c> from the ambient process env —
/// validation MUST fire on the rate-limit fields alone.</para>
/// </summary>
public sealed class FetcherOptionsValidationTests
{
    // ──────────────────────────────────────────────────────────────────────
    // 1. Negative absolute → reject (XML-doc: "Startup validation rejects values ≤ 0")
    // ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(-1)]
    [InlineData(-100)]
    [InlineData(0)]
    public void AddCiCdFetcher_NegativeOrZeroAbsolute_Throws(int absolute)
    {
        var options = NewMinimalOptions() with { RateLimitAbsolute = absolute };

        var ex = Record.Exception(() => new ServiceCollection().AddCiCdFetcher(options));

        Assert.NotNull(ex);
        // The exception message MUST mention the env-var name so an
        // operator deploying the fetcher can find the offending binding.
        Assert.Contains("FETCHER_RATE_LIMIT_ABSOLUTE", ex!.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. Over-100 percentage → reject
    // ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(101)]
    [InlineData(200)]
    [InlineData(int.MaxValue)]
    public void AddCiCdFetcher_OverHundredPercentage_Throws(int percentage)
    {
        var options = NewMinimalOptions() with { RateLimitPercentage = percentage };

        var ex = Record.Exception(() => new ServiceCollection().AddCiCdFetcher(options));

        Assert.NotNull(ex);
        Assert.Contains("FETCHER_RATE_LIMIT_PERCENTAGE", ex!.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. Non-positive percentage (0 or negative) → reject
    // ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-50)]
    public void AddCiCdFetcher_NonPositivePercentage_Throws(int percentage)
    {
        var options = NewMinimalOptions() with { RateLimitPercentage = percentage };

        var ex = Record.Exception(() => new ServiceCollection().AddCiCdFetcher(options));

        Assert.NotNull(ex);
        Assert.Contains("FETCHER_RATE_LIMIT_PERCENTAGE", ex!.Message, StringComparison.OrdinalIgnoreCase);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 4. Both null → accept (framework default 30% kicks in via Resolver)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void AddCiCdFetcher_BothNull_DoesNotThrow_AndResolverFallsBackToDefault30Percent()
    {
        var options = NewMinimalOptions() with
        {
            RateLimitAbsolute = null,
            RateLimitPercentage = null,
        };

        // Validation passes — no throw at host build time.
        var ex = Record.Exception(() => new ServiceCollection().AddCiCdFetcher(options));
        Assert.Null(ex);

        // Resolver falls back to DefaultPercentage (30 — CR-0011 § 3a "default 30").
        var cap = RateLimitResolver.Resolve(options, upstreamLimit: 5000);
        Assert.Equal(1500, cap); // 30% of 5000
    }

    // ──────────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Minimal valid <see cref="FetcherOptions"/> — empty <c>AdapterIds</c>
    /// so the GHA adapter registration (which reads <c>GHA_TOKEN</c> from
    /// the ambient env) does not fire. This keeps the rate-limit validation
    /// path isolated from unrelated env-var checks.
    /// </summary>
    private static FetcherOptions NewMinimalOptions() => new()
    {
        WriteApiUrl = "http://test/",
        WriteApiKey = "k",
        PollIntervalSeconds = 30,
        InitialFetchLimit = 50,
        AdapterIds = Array.Empty<string>(),
    };
}
