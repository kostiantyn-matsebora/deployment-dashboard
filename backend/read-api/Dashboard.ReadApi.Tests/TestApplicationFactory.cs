using Dashboard.Shared.Persistence;
using Dashboard.Shared.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> for the Read API.
/// Swaps the production DbContext for SQLite-in-memory and removes the
/// <see cref="DeploymentListener"/> hosted service so tests don't open a
/// real Postgres connection. The in-process <see cref="SlotUpdateBroker"/>
/// is left in place — endpoint tests can still publish to it directly to
/// exercise the SSE path.
/// </summary>
public sealed class TestApplicationFactory : WebApplicationFactory<Program>
{
    private SqliteConnection? _sqlite;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:DefaultConnection",
            "Host=placeholder;Database=test;Username=test;Password=test");

        builder.ConfigureTestServices(services =>
        {
            // Fully clear the Postgres-flavoured DashboardDbContext
            // registration before adding the SQLite one — EF refuses to
            // resolve a context whose options carry two providers.
            for (var i = services.Count - 1; i >= 0; i--)
            {
                var st = services[i].ServiceType;
                if (st == typeof(DashboardDbContext) ||
                    st == typeof(DbContextOptions<DashboardDbContext>) ||
                    st == typeof(DbContextOptions))
                {
                    services.RemoveAt(i);
                    continue;
                }
                if (st.IsGenericType &&
                    st.FullName?.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal) == true &&
                    st.GenericTypeArguments.Length == 1 &&
                    st.GenericTypeArguments[0] == typeof(DashboardDbContext))
                {
                    services.RemoveAt(i);
                }
            }

            _sqlite = new SqliteConnection("DataSource=:memory:");
            _sqlite.Open();
            services.AddDbContext<DashboardDbContext>(opt => opt.UseSqlite(_sqlite));

            // Strip the hosted services so they don't try to talk to Postgres.
            for (var i = services.Count - 1; i >= 0; i--)
            {
                if (services[i].ServiceType == typeof(IHostedService))
                {
                    services.RemoveAt(i);
                }
            }

            using var scope = services.BuildServiceProvider().CreateScope();
            scope.ServiceProvider.GetRequiredService<DashboardDbContext>().Database.EnsureCreated();
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _sqlite?.Dispose();
        base.Dispose(disposing);
    }
}
