using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> backed by a real Postgres container
/// (Testcontainers). Replaces <see cref="IDeploymentNotifier"/> with a no-op and injects
/// a known <c>API_KEY</c> so authentication tests have a stable key.
/// </summary>
internal sealed class TestApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string TestApiKey = "test-key";
    public const string TestControlApiKey = "test-control-key";

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

    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine")
        .Build();

    // IAsyncLifetime — start the container before any test uses the factory.
    public async Task InitializeAsync() => await _postgres.StartAsync();

    public new async Task DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureAppConfiguration((_, config) =>
        {
            var values = new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = _postgres.GetConnectionString(),
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
            if (!UseRealNotifier)
            {
                // Replace Postgres notifier with no-op so tests that don't need SSE fan-out
                // don't depend on the LISTEN connection being established.
                services.RemoveAll<IDeploymentNotifier>();
                services.AddScoped<IDeploymentNotifier, NullDeploymentNotifier>();
            }
        });
    }

    /// <summary>Applies EF migrations. Call once per test class / collection fixture.</summary>
    public async Task MigrateAsync()
    {
        using var scope = Services.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        await ctx.Database.MigrateAsync();
    }
}
