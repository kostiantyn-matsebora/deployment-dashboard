using Dashboard.Shared.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Api.Tests;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> for the unified
/// Dashboard.Api host. Swaps the production Npgsql DbContext for SQLite
/// in-memory and removes hosted services so tests don't open a real
/// Postgres connection.
///
/// <para>Mirrors <c>Dashboard.ReadApi.Tests.TestApplicationFactory</c>.
/// Diverges in two ways relevant to ADR-0009:
/// <list type="bullet">
///   <item>Does <strong>NOT</strong> call <c>EnsureCreated()</c> — the
///   startup hook in <c>Program.Main</c> runs <c>MigrateAsync</c> itself,
///   which is the behaviour under test. Calling EnsureCreated here would
///   pre-create the schema and mask the migration path entirely.</item>
///   <item>Exposes the sqlite <see cref="SqliteConnection"/> as
///   <see cref="Connection"/> so failure-injection tests can dispose /
///   corrupt it to force a migration failure.</item>
/// </list></para>
///
/// <para>Phase 5 (QA): override <see cref="ConfigureWebHost"/> via a
/// subclass — or use <see cref="WebApplicationFactory{T}.WithWebHostBuilder"/>
/// — to swap the connection for the failure-injection variant.</para>
/// </summary>
public class TestApplicationFactory : WebApplicationFactory<Dashboard.Api.Program>
{
    private SqliteConnection? _sqlite;

    /// <summary>
    /// The shared sqlite connection backing the test DbContext. Null until
    /// the host has been built (i.e. until <see cref="CreateClient"/> or
    /// <see cref="WebApplicationFactory{T}.Services"/> has been accessed).
    /// </summary>
    public SqliteConnection? Connection => _sqlite;

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
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _sqlite?.Dispose();
        base.Dispose(disposing);
    }
}
