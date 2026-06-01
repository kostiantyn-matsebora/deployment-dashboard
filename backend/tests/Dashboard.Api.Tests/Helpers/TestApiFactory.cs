using Dashboard.Control.Options;
using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> backed by a caller-supplied Postgres
/// connection string (provided by <see cref="PostgresFixture"/>). The factory is cheap
/// to construct — it does not own or start a container.
///
/// Per-class configuration knobs (<see cref="UseRealNotifier"/>, <see cref="IncludeControlKey"/>,
/// <see cref="ForcedResetState"/>, <see cref="ResetConfig"/>) configure the in-process
/// ASP.NET Core host and remain unchanged from the previous design.
/// </summary>
internal sealed class TestApiFactory : WebApplicationFactory<Program>
{
    public const string TestApiKey = "test-key";
    public const string TestControlApiKey = "test-control-key";

    private readonly string _connectionString;

    /// <param name="connectionString">
    /// Postgres connection string from the shared <see cref="PostgresFixture"/>.
    /// </param>
    public TestApiFactory(string connectionString) => _connectionString = connectionString;

    /// <summary>
    /// When <c>true</c> the real <see cref="Dashboard.Write.Notifiers.PostgresDeploymentNotifier"/>
    /// is used, enabling end-to-end LISTEN/NOTIFY fan-out for SSE live-stream tests.
    /// Defaults to <c>false</c> (no-op notifier) for all other test classes.
    /// </summary>
    public bool UseRealNotifier { get; init; }

    /// <summary>
    /// When <c>false</c>, <c>CONTROL_API_KEY</c> is omitted from configuration so that
    /// the control surface behaves as if the key was never set (returns <c>404</c>).
    /// Defaults to <c>true</c>.
    /// </summary>
    public bool IncludeControlKey { get; init; } = true;

    /// <summary>
    /// When set, replaces the real <see cref="IResetStateProvider"/> singleton with this
    /// controllable stub so tests can force the ingest gate without triggering NOTIFY/LISTEN.
    /// Used by <see cref="ResetChoreographyTests"/> for the 503 gate test (Fix C).
    /// </summary>
    public ForcedResetStateProvider? ForcedResetState { get; init; }

    /// <summary>
    /// When set, overrides the <c>Reset</c> configuration section so tests can control
    /// <c>AckTimeoutSeconds</c> and <c>ExpectedComponents</c> without relying on defaults.
    /// </summary>
    public ResetConfigOverride? ResetConfig { get; init; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            var values = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = _connectionString,
                ["API_KEY"] = TestApiKey,
            };

            // Explicitly null out the key when not included so that any value from
            // appsettings.Development.json (which WebApplicationFactory loads by default)
            // does not leak through.
            values["CONTROL_API_KEY"] = IncludeControlKey ? TestControlApiKey : null;

            config.AddInMemoryCollection(values);
        });

        builder.ConfigureServices(services =>
        {
            if (ResetConfig is { } rc)
            {
                // Apply Reset overrides imperatively via PostConfigure rather than through
                // configuration keys. The .NET configuration binder MERGES array indices onto
                // the ResetOptions default initializer (["dashboard-fetcher","demo-driver"])
                // instead of replacing the array, so a config-key override of ExpectedComponents
                // would leave stale default entries (and empty slots) in the bound array — the
                // orchestrator would then wait on acks the test never sends. PostConfigure runs
                // after binding and lets us replace the array wholesale, deterministically.
                services.PostConfigure<ResetOptions>(o =>
                {
                    if (rc.AckTimeoutSeconds.HasValue)
                        o.AckTimeoutSeconds = rc.AckTimeoutSeconds.Value;
                    if (rc.ExpectedComponents is { } components)
                        o.ExpectedComponents = components;
                    if (rc.GateMaxTtlSeconds.HasValue)
                        o.GateMaxTtlSeconds = rc.GateMaxTtlSeconds.Value;
                });
            }

            if (!UseRealNotifier)
            {
                // Replace Postgres notifier with no-op so tests that don't need SSE fan-out
                // don't depend on the LISTEN connection being established.
                services.RemoveAll<IDeploymentNotifier>();
                services.AddScoped<IDeploymentNotifier, NullDeploymentNotifier>();
            }

            if (ForcedResetState is not null)
            {
                // Replace the real ResetStateListener singleton with a controllable stub.
                // This lets tests verify the 503 gate path without going through NOTIFY/LISTEN.
                services.RemoveAll<IResetStateProvider>();
                services.AddSingleton<IResetStateProvider>(ForcedResetState);
            }
        });
    }

    /// <summary>Applies EF migrations against the shared Postgres instance.</summary>
    public async Task MigrateAsync()
    {
        using var scope = Services.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        await ctx.Database.MigrateAsync();
    }
}

/// <summary>
/// Carries overrides for the <c>Reset</c> appsettings section used in
/// <see cref="TestApiFactory.ResetConfig"/>.
/// </summary>
internal sealed record ResetConfigOverride(
    int? AckTimeoutSeconds = null,
    string[]? ExpectedComponents = null,
    int? GateMaxTtlSeconds = null);
