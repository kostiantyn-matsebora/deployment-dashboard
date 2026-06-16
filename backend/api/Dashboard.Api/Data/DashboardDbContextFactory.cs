using Dashboard.Shared.Configuration;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Api.Data;

/// <summary>
/// Design-time factory used by <c>dotnet ef</c> to create a <see cref="DashboardDbContext"/>
/// without a running application host. Not used at runtime.
/// </summary>
internal sealed class DashboardDbContextFactory : IDesignTimeDbContextFactory<DashboardDbContext>
{
    public DashboardDbContext CreateDbContext(string[] args)
    {
        // Build a minimal configuration from environment variables so that the same
        // POSTGRES_* env vars that drive the runtime also drive design-time EF tooling.
        var configuration = new ConfigurationBuilder()
            .AddEnvironmentVariables()
            .Build();

        // Design-time (dotnet-ef migrations/scaffolding) always runs with static credentials
        // in CI — use the connection string directly to avoid disposing an NpgsqlDataSource
        // before the returned context has a chance to use it.
        var connectionString = PostgresConnectionString.Resolve(configuration);

        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new DashboardDbContext(options);
    }
}
