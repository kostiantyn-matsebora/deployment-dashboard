using Dashboard.Fetcher.Configuration;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Tests.Configuration;

public sealed class FetcherOptionsEnvTests
{
    // ── POLL_INTERVAL_SECONDS ────────────────────────────────────────────────

    [Fact]
    public void PollIntervalSeconds_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["POLL_INTERVAL_SECONDS"] = "10" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(10, options.PollIntervalSeconds);
    }

    [Fact]
    public void PollIntervalSeconds_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(30, options.PollIntervalSeconds);
    }

    [Fact]
    public void PollIntervalSeconds_KeepsDefault_WhenValueUnparseable()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["POLL_INTERVAL_SECONDS"] = "garbage" });

        var exception = Record.Exception(() => FetcherOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal(30, options.PollIntervalSeconds);
    }

    // ── DISCOVERY_INTERVAL_SECONDS (issue #391 — preset discovery; see
    // FETCHER_SPECIFICATION.md "Preset discovery") ──────────────────────────

    [Fact]
    public void DiscoveryIntervalSeconds_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["DISCOVERY_INTERVAL_SECONDS"] = "60" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(60, options.DiscoveryIntervalSeconds);
    }

    [Fact]
    public void DiscoveryIntervalSeconds_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(3600, options.DiscoveryIntervalSeconds);
    }

    [Fact]
    public void DiscoveryIntervalSeconds_KeepsDefault_WhenValueUnparseable()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["DISCOVERY_INTERVAL_SECONDS"] = "garbage" });

        var exception = Record.Exception(() => FetcherOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal(3600, options.DiscoveryIntervalSeconds);
    }

    // ── BACKFILL_MAX_AGE ─────────────────────────────────────────────────────

    [Fact]
    public void BackfillMaxAge_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["BACKFILL_MAX_AGE"] = "30.00:00:00" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(TimeSpan.FromDays(30), options.BackfillMaxAge);
    }

    [Fact]
    public void BackfillMaxAge_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(TimeSpan.Zero, options.BackfillMaxAge);
    }

    [Fact]
    public void BackfillMaxAge_KeepsDefault_WhenValueUnparseable()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["BACKFILL_MAX_AGE"] = "garbage" });

        var exception = Record.Exception(() => FetcherOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal(TimeSpan.Zero, options.BackfillMaxAge);
    }

    // ── INITIAL_LOOKBACK ─────────────────────────────────────────────────────

    [Fact]
    public void InitialLookback_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["INITIAL_LOOKBACK"] = "14.00:00:00" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(TimeSpan.FromDays(14), options.InitialLookback);
    }

    [Fact]
    public void InitialLookback_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(TimeSpan.FromDays(7), options.InitialLookback);
    }

    // ── BACKFILL_DEPTH ────────────────────────────────────────────────────────

    [Fact]
    public void BackfillDepth_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["BACKFILL_DEPTH"] = "5" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(5, options.BackfillDepth);
    }

    [Fact]
    public void BackfillDepth_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(2, options.BackfillDepth);
    }

    // ── BACKFILL ──────────────────────────────────────────────────────────────

    [Fact]
    public void Backfill_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["BACKFILL"] = "true" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.True(options.Backfill);
    }

    [Fact]
    public void Backfill_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.False(options.Backfill);
    }

    // ── CONTROL_API_KEY / COMPONENT_ID ───────────────────────────────────────

    [Fact]
    public void ControlApiKey_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["CONTROL_API_KEY"] = "secret-key" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("secret-key", options.ControlApiKey);
    }

    [Fact]
    public void ControlApiKey_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.ControlApiKey);
    }

    [Fact]
    public void ComponentId_OverridesDefault_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["COMPONENT_ID"] = "my-fetcher" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("my-fetcher", options.ComponentId);
    }

    [Fact]
    public void ComponentId_KeepsDefault_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("dashboard-fetcher", options.ComponentId);
    }

    // ── absent keys — all defaults survive together ───────────────────────────

    [Fact]
    public void AllDefaults_Preserved_WhenNoKeysPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(30, options.PollIntervalSeconds);
        Assert.Equal(3600, options.DiscoveryIntervalSeconds);
        Assert.Equal(TimeSpan.FromDays(7), options.InitialLookback);
        Assert.False(options.Backfill);
        Assert.Equal(TimeSpan.Zero, options.BackfillMaxAge);
        Assert.Equal(2, options.BackfillDepth);
        Assert.Equal("", options.ControlApiKey);
        Assert.Equal("dashboard-fetcher", options.ComponentId);
    }

    // ── EffectiveBackfillMaxAge reflects explicit override ───────────────────

    [Fact]
    public void EffectiveBackfillMaxAge_ReflectsExplicitBackfillMaxAge()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["BACKFILL_MAX_AGE"] = "30.00:00:00" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(TimeSpan.FromDays(30), options.EffectiveBackfillMaxAge);
    }

    [Fact]
    public void EffectiveBackfillMaxAge_FallsBackToInitialLookback_WhenBackfillMaxAgeAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["INITIAL_LOOKBACK"] = "14.00:00:00" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        // BackfillMaxAge is Zero → EffectiveBackfillMaxAge falls back to InitialLookback
        Assert.Equal(TimeSpan.FromDays(14), options.EffectiveBackfillMaxAge);
    }

    // ── FETCHER_NOW (clock pin) ──────────────────────────────────────────────

    [Fact]
    public void FetcherNow_SetsNowOverride_WhenKeyPresent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["FETCHER_NOW"] = "2026-06-06T12:00:00Z" });

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), options.NowOverride);
    }

    [Fact]
    public void FetcherNow_LeavesNowOverrideNull_WhenKeyAbsent()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        FetcherOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Null(options.NowOverride);
    }

    [Fact]
    public void FetcherNow_LeavesNowOverrideNull_WhenValueUnparseable()
    {
        var options = new FetcherOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["FETCHER_NOW"] = "not-a-date" });

        var exception = Record.Exception(() => FetcherOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Null(options.NowOverride);
    }

    [Fact]
    public void UtcNow_ReturnsOverride_WhenSet()
    {
        var pinned = new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
        var options = new FetcherOptions { NowOverride = pinned };

        Assert.Equal(pinned, options.UtcNow);
    }

    [Fact]
    public void UtcNow_ReturnsWallClock_WhenOverrideNull()
    {
        var options = new FetcherOptions();

        var before = DateTimeOffset.UtcNow;
        var actual = options.UtcNow;
        var after = DateTimeOffset.UtcNow;

        Assert.InRange(actual, before, after);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
