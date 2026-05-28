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
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Postgres"] = _postgres.GetConnectionString(),
                ["API_KEY"] = TestApiKey,
            });
        });

        builder.ConfigureServices(services =>
        {
            // Replace Postgres notifier with no-op (LISTEN/NOTIFY is Phase 5).
            services.RemoveAll<IDeploymentNotifier>();
            services.AddScoped<IDeploymentNotifier, NullDeploymentNotifier>();
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
