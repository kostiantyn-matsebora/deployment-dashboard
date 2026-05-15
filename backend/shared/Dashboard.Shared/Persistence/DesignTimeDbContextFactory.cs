using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Dashboard.Shared.Persistence;

/// <summary>
/// Used by <c>dotnet ef migrations add</c> / <c>dotnet ef database update</c>
/// when invoked from <c>backend/shared/Dashboard.Shared/</c>.
///
/// <para>The factory reads <c>ConnectionStrings__DefaultConnection</c>
/// from the environment so design-time tooling targets the same Postgres
/// instance as the running APIs. When unset, a placeholder is used —
/// the migration code itself doesn't depend on the connection string,
/// only on the resolved provider, so this lets <c>dotnet ef</c> generate
/// migrations even on a fresh checkout.</para>
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<DashboardDbContext>
{
    public DashboardDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
                 ?? "Host=localhost;Port=5432;Database=dashboard;Username=dashboard;Password=dashboard";

        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(cs, npg => npg.MigrationsAssembly(typeof(DashboardDbContext).Assembly.FullName))
            .Options;

        return new DashboardDbContext(options);
    }
}
