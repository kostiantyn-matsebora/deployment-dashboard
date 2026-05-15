using Dashboard.Shared.Dto;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Realtime;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.WriteApi.Tests;

/// <summary>
/// <see cref="WebApplicationFactory{TEntryPoint}"/> for the Write API.
/// Replaces the production Postgres-backed <see cref="DashboardDbContext"/>
/// with a per-factory SQLite-in-memory instance, and swaps the
/// <see cref="DeploymentNotifier"/> for a recorder so tests can assert
/// that NOTIFY was attempted without needing a real Postgres.
/// </summary>
public sealed class TestApplicationFactory : WebApplicationFactory<Program>
{
    public string ApiKey { get; } = "test-key";
    public RecordingNotifier Notifier { get; } = new();

    private SqliteConnection? _sqlite;

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
            services.AddDbContext<DashboardDbContext>(opt => opt.UseSqlite(_sqlite));

            // Replace the notifier so no Postgres connection is attempted.
            services.RemoveAll<DeploymentNotifier>();
            services.AddSingleton<DeploymentNotifier>(Notifier);

            // Build the schema on first scope.
            using var scope = services.BuildServiceProvider().CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Database.EnsureCreated();
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
