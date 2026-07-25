using Dashboard.Control;
using Dashboard.Control.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Tests;

/// <summary>
/// Integration tests that verify the FULL DI wiring of <see cref="ResetOptionsEnv"/>
/// through <see cref="ControlServiceExtensions.AddControlServices"/>.
///
/// The production path is:
///   AddOptions&lt;ResetOptions&gt;()
///     .BindConfiguration("Reset")        // reads appsettings-style section
///     .Configure&lt;IConfiguration&gt;(...)    // then calls ResetOptionsEnv.ApplyEnvOverrides(cfg, opts)
///
/// The flat SCREAMING_SNAKE keys are read from <see cref="IConfiguration"/>, not from
/// <see cref="System.Environment"/>. Tests inject them via an in-memory configuration
/// source — the same interface the production Configure delegate sees.
/// </summary>
public sealed class ResetOptionsEnvWiringTests
{
    // ── Override present: all three vars set ──────────────────────────────────

    [Fact]
    public void AddControlServices_WhenAllEnvVarsPresent_OverridesApplyWholesale()
    {
        // Arrange: in-memory config carries both the appsettings "Reset" section defaults
        // AND the flat SCREAMING_SNAKE override keys.
        var config = BuildConfig(new Dictionary<string, string?>
        {
            // appsettings-style section (what BindConfiguration("Reset") reads)
            ["Reset:AckTimeoutSeconds"] = "10",
            ["Reset:GateMaxTtlSeconds"] = "60",
            ["Reset:ExpectedComponents:0"] = "dashboard-fetcher",
            ["Reset:ExpectedComponents:1"] = "demo-driver",
            // env-var overrides (what ResetOptionsEnv.ApplyEnvOverrides reads)
            ["RESET_ACK_TIMEOUT_SECONDS"] = "7",
            ["RESET_GATE_MAX_TTL_SECONDS"] = "42",
            ["RESET_EXPECTED_COMPONENTS"] = "a,b,c",
            ["RESET_RECOVER_MAX_DAYS_BACK"] = "30",
        });

        var provider = BuildProvider(config);

        // Act
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        // Assert: env overrides win over the appsettings-bound defaults.
        Assert.Equal(7, opts.AckTimeoutSeconds);
        Assert.Equal(42, opts.GateMaxTtlSeconds);
        Assert.Equal(["a", "b", "c"], opts.ExpectedComponents);
        Assert.Equal(30, opts.RecoverMaxDaysBack);
    }

    [Fact]
    public void AddControlServices_ExpectedComponents_CsvReplacesArrayWholesale_NotAppended()
    {
        // The env var must REPLACE the appsettings array, not append.
        // If it were appended the result would be ["dashboard-fetcher","demo-driver","a","b","c"].
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Reset:ExpectedComponents:0"] = "dashboard-fetcher",
            ["Reset:ExpectedComponents:1"] = "demo-driver",
            ["RESET_EXPECTED_COMPONENTS"] = "a,b,c",
        });

        var provider = BuildProvider(config);
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        // Exactly 3 elements — no phantom appsettings entries.
        Assert.Equal(3, opts.ExpectedComponents.Length);
        Assert.Equal(["a", "b", "c"], opts.ExpectedComponents);
    }

    // ── Override absent: falls back to bound appsettings defaults ────────────

    [Fact]
    public void AddControlServices_WhenEnvVarsAbsent_FallsBackToBoundDefaults()
    {
        // Only the appsettings section is present; no SCREAMING_SNAKE keys.
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Reset:AckTimeoutSeconds"] = "10",
            ["Reset:GateMaxTtlSeconds"] = "60",
            ["Reset:ExpectedComponents:0"] = "dashboard-fetcher",
            ["Reset:ExpectedComponents:1"] = "demo-driver",
        });

        var provider = BuildProvider(config);
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        Assert.Equal(10, opts.AckTimeoutSeconds);
        Assert.Equal(60, opts.GateMaxTtlSeconds);
        Assert.Equal(["dashboard-fetcher", "demo-driver"], opts.ExpectedComponents);
    }

    [Fact]
    public void AddControlServices_WhenOnlyAckTimeoutPresent_OnlyThatFieldOverridden()
    {
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Reset:AckTimeoutSeconds"] = "10",
            ["Reset:GateMaxTtlSeconds"] = "60",
            ["Reset:ExpectedComponents:0"] = "dashboard-fetcher",
            ["Reset:ExpectedComponents:1"] = "demo-driver",
            ["RESET_ACK_TIMEOUT_SECONDS"] = "7",
            // RESET_GATE_MAX_TTL_SECONDS and RESET_EXPECTED_COMPONENTS absent
        });

        var provider = BuildProvider(config);
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        Assert.Equal(7, opts.AckTimeoutSeconds);
        Assert.Equal(60, opts.GateMaxTtlSeconds);  // bound default survives
        Assert.Equal(["dashboard-fetcher", "demo-driver"], opts.ExpectedComponents); // bound default survives
    }

    [Fact]
    public void AddControlServices_RecoverMaxDaysBack_OverridesIndependently()
    {
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Reset:AckTimeoutSeconds"] = "10",
            ["Reset:GateMaxTtlSeconds"] = "60",
            ["Reset:RecoverMaxDaysBack"] = "90",
            ["RESET_RECOVER_MAX_DAYS_BACK"] = "14",
            // Other env overrides absent — must not be affected.
        });

        var provider = BuildProvider(config);
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        Assert.Equal(14, opts.RecoverMaxDaysBack);
        Assert.Equal(10, opts.AckTimeoutSeconds); // unrelated field survives
    }

    [Fact]
    public void AddControlServices_RecoverMaxDaysBack_WhenEnvVarAbsent_FallsBackToBoundDefault()
    {
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["Reset:RecoverMaxDaysBack"] = "90",
        });

        var provider = BuildProvider(config);
        var opts = provider.GetRequiredService<IOptions<ResetOptions>>().Value;

        Assert.Equal(90, opts.RecoverMaxDaysBack);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds a <see cref="ServiceProvider"/> that has called <see cref="ControlServiceExtensions.AddControlServices"/>
    /// with the supplied <paramref name="config"/> registered as <see cref="IConfiguration"/>.
    /// Non-essential services that require DB connections are not configured; this is fine because
    /// the test only resolves <see cref="IOptions{TOptions}"/>, which is resolved eagerly from
    /// the DI container without opening any connections.
    /// </summary>
    private static IServiceProvider BuildProvider(IConfiguration config)
    {
        var services = new ServiceCollection();
        services.AddSingleton(config);
        services.AddControlServices();
        // AddControlServices registers many singletons/scoped services that depend on
        // IServiceProvider / IConfiguration via IOptions — but Options resolution is
        // lazy and does not require the downstream services to be resolvable here.
        return services.BuildServiceProvider();
    }

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
}
