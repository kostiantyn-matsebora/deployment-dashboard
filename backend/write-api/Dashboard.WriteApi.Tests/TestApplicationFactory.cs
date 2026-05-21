using Dashboard.Shared.Dto;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.WriteApi.Tests;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> for the Write API.
/// Replaces the production Postgres-backed <see cref="DashboardDbContext"/>
/// with a per-factory SQLite-in-memory instance, and swaps the
/// <see cref="DeploymentNotifier"/> for a recorder so tests can assert
/// that NOTIFY was attempted without needing a real Postgres.
///
/// <para>Mirrors the ADR-0009 accommodations established in
/// <c>Dashboard.Api.Tests.TestApplicationFactory</c> (see that type for the
/// full diagnostic write-up):
/// <list type="bullet">
///   <item>Suppresses <c>PendingModelChangesWarning</c> — the shared model
///   snapshot is Npgsql-flavoured (jsonb, ValueGenerationStrategy) and EF
///   Core 9+ elevates that warning to an error during <c>MigrateAsync</c>.
///   The warning reflects a test-host provider-metadata diff, not a
///   production contract violation (verified via
///   <c>dotnet ef migrations has-pending-model-changes</c>: "No changes
///   have been made to the model since the last migration").</item>
///   <item>Seeds <c>__EFMigrationsHistory</c> with every known migration id
///   so the ADR-0009 <c>MigrateAsync</c> call in <c>Program.Main</c> finds
///   nothing pending and exits as a no-op — the production migrations
///   contain Postgres-only DDL (<c>'{}'::text[]</c>, <c>jsonb</c>,
///   <c>id::text</c>) that sqlite cannot execute.</item>
/// </list></para>
/// </summary>
public sealed class TestApplicationFactory : WebApplicationFactory<Dashboard.Api.Program>
{
    public string ApiKey { get; } = "test-key";
    public RecordingNotifier Notifier { get; } = new();

    private SqliteConnection? _sqlite;

    /// <summary>
    /// Migration ids bundled with <c>Dashboard.Shared</c> as of the
    /// ADR-0009 commit. Kept inline (not lifted into a shared helper)
    /// because <c>Dashboard.Shared.Tests</c> is a test project, not a
    /// library, and <c>ProjectReference</c> from another test project is
    /// disallowed in this tooling. Sister copies live in
    /// <c>Dashboard.Api.Tests.TestApplicationFactory</c> and
    /// <c>Dashboard.ReadApi.Tests.TestApplicationFactory</c>; keep all
    /// three in sync when a migration is added.
    /// </summary>
    private static readonly string[] KnownMigrations =
    {
        "20260514154415_CreateDeploymentsTable",
        "20260515120000_AddTopologyColumnsAndConfig",
        "20260515160000_AddRefAndShaColumns",
        "20260518120000_AddProgressReporterAndFetcherState",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Program.cs requires ConnectionStrings:DefaultConnection AND
        // API_TOKEN to be set. We provide placeholders here; the actual
        // DbContext and notifier are replaced in ConfigureTestServices.
        Environment.SetEnvironmentVariable("API_TOKEN", ApiKey);
        builder.UseSetting("ConnectionStrings:DefaultConnection",
            "Host=placeholder;Database=test;Username=test;Password=test");

        builder.ConfigureTestServices(services =>
        {
            // Strip every DashboardDbContext-related registration that the
            // production composition root added (DbContext itself, options,
            // the Npgsql-specific option setters). Otherwise the new
            // AddDbContext call below ends up co-registered with the
            // Npgsql provider and EF Core refuses to resolve.
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
                // EF Core's internal "options configuration" registration —
                // its name varies across versions; match by full-name prefix.
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
                // See class-level remarks: provider-metadata diff between
                // the Npgsql-flavoured snapshot and the sqlite test
                // provider is a false-positive, not real model drift.
                .ConfigureWarnings(w => w.Ignore(
                    RelationalEventId.PendingModelChangesWarning)));

            // Replace the notifier so no Postgres connection is attempted.
            services.RemoveAll<DeploymentNotifier>();
            services.AddSingleton<DeploymentNotifier>(Notifier);

            // Pre-stage the database state BEFORE the ADR-0009 startup
            // hook fires: EnsureCreated() materialises the model snapshot
            // into sqlite-compatible DDL, then __EFMigrationsHistory is
            // seeded with every known migration id so MigrateAsync sees
            // nothing pending and exits as a no-op. The literal migration
            // SQL is a Postgres concern, implicitly covered by the
            // production deployment smoke test.
            using var scope = services.BuildServiceProvider().CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Database.EnsureCreated();

            db.Database.ExecuteSqlRaw(
                "CREATE TABLE IF NOT EXISTS \"__EFMigrationsHistory\" (" +
                "  \"MigrationId\" TEXT NOT NULL PRIMARY KEY," +
                "  \"ProductVersion\" TEXT NOT NULL);");

            foreach (var migrationId in KnownMigrations)
            {
                db.Database.ExecuteSqlRaw(
                    "INSERT OR IGNORE INTO \"__EFMigrationsHistory\" " +
                    "(\"MigrationId\", \"ProductVersion\") VALUES ({0}, {1});",
                    migrationId, "10.0.0-test");
            }
        });
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _sqlite?.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>Recording test double for <see cref="DeploymentNotifier"/>.</summary>
public sealed class RecordingNotifier : DeploymentNotifier
{
    public List<DeploymentEventResponse> Published { get; } = new();

    public RecordingNotifier() : base(string.Empty, NullLogger<DeploymentNotifier>.Instance) { }

    public override Task PublishAsync(DeploymentEventResponse evt, CancellationToken ct = default)
    {
        Published.Add(evt);
        return Task.CompletedTask;
    }
}

/// <summary>Tiny helper: remove all registrations matching a service type.</summary>
internal static class ServiceCollectionExtensions
{
    public static void RemoveAll<T>(this IServiceCollection services)
    {
        for (var i = services.Count - 1; i >= 0; i--)
        {
            if (services[i].ServiceType == typeof(T)) services.RemoveAt(i);
        }
    }
}
