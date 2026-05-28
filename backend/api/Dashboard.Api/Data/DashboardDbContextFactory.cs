using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Dashboard.Api.Data;

/// <summary>
/// Design-time factory used by <c>dotnet ef</c> to create a <see cref="DashboardDbContext"/>
/// without a running application host. Not used at runtime.
/// </summary>
internal sealed class DashboardDbContextFactory : IDesignTimeDbContextFactory<DashboardDbContext>
{
    public DashboardDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(
                Environment.GetEnvironmentVariable("ConnectionStrings__Postgres")
                ?? "Host=localhost;Database=dashboard_dev;Username=dashboard;Password=dashboard")
            .Options;

        return new DashboardDbContext(options);
    }
}
