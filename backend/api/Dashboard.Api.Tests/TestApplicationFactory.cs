using Dashboard.Shared.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Api.Tests;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> for the unified
/// Dashboard.Api host. Swaps the production Npgsql DbContext for SQLite
/// in-memory, removes hosted services so tests don't open a real Postgres
/// connection, and pre-stages the schema so the ADR-0009 startup
/// <c>MigrateAsync</c> hook executes as a no-op against a sqlite-friendly
/// database state.
///
/// <para>Mirrors <c>Dashboard.ReadApi.Tests.TestApplicationFactory</c> but
/// diverges in two ways relevant to ADR-0009:
/// <list type="bullet">
///   <item>Suppresses <c>PendingModelChangesWarning</c> — the shared
///   model snapshot is Npgsql-flavoured (jsonb, ValueGenerationStrategy)
///   and EF Core 9+ elevates that warning to an error during
///   <c>MigrateAsync</c>. The warning reflects a test-host artefact, not a
///   production contract violation.</item>
///   <item>Seeds <c>__EFMigrationsHistory</c> with every known migration id
///   so the ADR-0009 <c>MigrateAsync</c> call finds nothing pending and
///   exits as a no-op — the production migrations contain Postgres-only
///   DDL (<c>'{}'::text[]</c>, <c>id::text</c>) that sqlite cannot
///   execute end-to-end.</item>
/// </list></para>
///
/// <para>The <see cref="Connection"/> property exposes the sqlite
/// <see cref="SqliteConnection"/> so failure-injection variants in
/// <see cref="StartupMigrationTests"/> can replace it with an unreachable
/// Npgsql endpoint to force a migration failure during startup.</para>
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
            services.AddDbContext<DashboardDbContext>(opt => opt
                .UseSqlite(_sqlite)
                // The shared DbContextModelSnapshot is Npgsql-flavoured
                // (jsonb column types, ValueGenerationStrategy annotations);
                // re-resolving the model under the sqlite provider triggers
                // PendingModelChangesWarning, which EF Core 9+ elevates to
                // an error during MigrateAsync. The ADR-0009 hook is what
                // we want to exercise — not the diff between two providers'
                // metadata — so we down-grade the warning to a no-op for
                // the test host only. Production keeps the default
                // behaviour (Npgsql model ↔ Npgsql snapshot, no diff).
                .ConfigureWarnings(w => w.Ignore(
                    RelationalEventId.PendingModelChangesWarning)));

            // Pre-stage the database state BEFORE the ADR-0009 startup hook
            // fires:
            //
            //   1. EnsureCreated() materialises the model snapshot into
            //      sqlite-compatible DDL. The production migrations contain
            //      Postgres-only constructs ('{}'::text[], jsonb, id::text)
            //      that sqlite cannot parse, so they cannot literally
            //      execute here. EnsureCreated gives the test a queryable
            //      schema instead.
            //
            //   2. We then seed the __EFMigrationsHistory table with every
            //      migration id known to the assembly. With every migration
            //      already marked applied, MigrateAsync (which the
            //      ADR-0009 hook calls in Program.cs) finds nothing pending
            //      and exits as a no-op — but it IS still invoked, which is
            //      the temporal contract being asserted.
            //
            // The contract under test is "startup applies pending
            // migrations before the HTTP listener is bound + a failure
            // aborts startup." Test 1 verifies the success path leaves the
            // schema queryable; test 2 swaps the DbContext registration
            // and asserts the failure path. The literal migration SQL is
            // a Postgres concern + is implicitly covered by EF Core's own
            // test suite + by the production deployment smoke test.
            using (var bootstrapScope = services.BuildServiceProvider().CreateScope())
            {
                var bootstrapDb = bootstrapScope.ServiceProvider
                    .GetRequiredService<DashboardDbContext>();
                bootstrapDb.Database.EnsureCreated();

                // Reflect the model snapshot's full migration set into the
                // history table so MigrateAsync sees nothing pending. The
                // migration ids match the file timestamps in
                // backend/shared/Dashboard.Shared/Migrations/.
                bootstrapDb.Database.ExecuteSqlRaw(
                    "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (" +
                    "  \"MigrationId\" TEXT NOT NULL PRIMARY KEY," +
                    "  \"ProductVersion\" TEXT NOT NULL);");

                foreach (var migrationId in KnownMigrations)
                {
                    bootstrapDb.Database.ExecuteSqlRaw(
                        "INSERT OR IGNORE INTO \"__EFMigrationsHistory\" " +
                        "(\"MigrationId\", \"ProductVersion\") VALUES ({0}, {1});",
                        migrationId, "10.0.0-test");
                }
            }

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

    /// <summary>
    /// Migration ids bundled with <c>Dashboard.Shared</c> as of the
    /// ADR-0009 commit. Used by <see cref="ConfigureWebHost"/> to pre-seed
    /// <c>__EFMigrationsHistory</c> so the production MigrateAsync hook
    /// sees nothing pending. Tests verify these ids round-trip via
    /// <c>DashboardDbContext.Database.GetAppliedMigrationsAsync()</c>.
    /// </summary>
    public static readonly string[] KnownMigrations =
    {
        "20260514154415_CreateDeploymentsTable",
        "20260515120000_AddTopologyColumnsAndConfig",
        "20260515160000_AddRefAndShaColumns",
        "20260518120000_AddProgressReporterAndFetcherState",
    };

    protected override void Dispose(bool disposing)
    {
        if (disposing) _sqlite?.Dispose();
        base.Dispose(disposing);
    }
}
