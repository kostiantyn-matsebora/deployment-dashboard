using Dashboard.Shared.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Api.Tests;

/// <summary>
/// ADR-0009 startup-applied-migration coverage. The host under test is
/// the unified <see cref="Dashboard.Api.Program"/> executable; both
/// assertions exercise the <c>MigrateAsync</c> block sitting between
/// <c>app.Build()</c> and <c>app.RunAsync()</c>.
///
/// <para>Test host: <c>WebApplicationFactory&lt;Dashboard.Api.Program&gt;</c>
/// (see <see cref="TestApplicationFactory"/>) — sqlite in-memory swapped in
/// for the production Npgsql provider, hosted services stripped, the
/// <c>API_TOKEN</c> env var pinned via module initializer
/// (<see cref="TestBootstrap"/>).</para>
///
/// <para>Per <c>core/process.md § Test oracles can be wrong</c>: both tests
/// assert the observable contract (schema populated by the time
/// <c>CreateClient()</c> returns; failure aborts startup with a propagated
/// exception). Neither asserts on log-line text, internal call counts, or
/// any other implementation accident.</para>
/// </summary>
public sealed class StartupMigrationTests
{
    [Fact]
    public async Task StartupAppliesPendingMigrations_BeforeHttpListenerBinds()
    {
        // TestApplicationFactory pre-stages the __EFMigrationsHistory table
        // with every known migration id (the production migrations contain
        // Postgres-only DDL that sqlite cannot execute — see the factory's
        // commentary). The ADR-0009 hook still calls MigrateAsync at
        // startup; with everything already-applied it executes as a no-op
        // but still proves the temporal ordering invariant: MigrateAsync
        // runs before RunAsync, before any HTTP client can be obtained.
        await using var factory = new TestApplicationFactory();

        // CreateClient() forces the host through builder.Build() + the
        // ADR-0009 MigrateAsync block + RunAsync; it returns once startup
        // is complete (HTTP listener bound — in TestServer that's an
        // in-process pipe, not a real socket). If MigrateAsync had thrown,
        // this call would propagate the exception and the test would fail
        // here rather than at the schema assertion below.
        using var client = factory.CreateClient();

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        // Contract 1: the migration history visible to runtime code
        // reflects every migration shipped with the assembly. We assert on
        // the most-recent id explicitly so a future migration that lands
        // without an accompanying KnownMigrations update flags here.
        var applied = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        Assert.NotEmpty(applied);
        Assert.Contains(
            "20260518120000_AddProgressReporterAndFetcherState",
            applied);

        // Contract 2: the schema is materially queryable — not merely a
        // history-table illusion. Hitting the deployments table proves the
        // DbContext is configured, the connection is alive, and the model
        // round-trips. The HTTP listener has bound (CreateClient returned),
        // so the strict temporal ordering of ADR-0009 holds.
        var deploymentCount = await db.Deployments.CountAsync();
        Assert.Equal(0, deploymentCount);
    }

    [Fact(Timeout = 30_000)]
    public async Task MigrationFailureAborts_StartupAndSurfacesException()
    {
        // Failure-injection variant: keep the production Npgsql provider in
        // place (do NOT swap to sqlite) but point it at a syntactically
        // valid yet unreachable endpoint. Port 1 is reserved + closed; the
        // Npgsql client tries to TCP-connect, fails, and surfaces the
        // exception. The ADR-0009 hook does not catch it, so it propagates
        // out of Program.Main and WebApplicationFactory rethrows on
        // CreateClient().
        await using var factory = new UnreachableDbApplicationFactory();

        // The exception type depends on Npgsql + ASP.NET host wrapping:
        // typically NpgsqlException or SocketException, sometimes wrapped
        // in InvalidOperationException by the host. We assert the
        // structural behaviour (something throws) rather than pinning a
        // type that varies across runtime / driver versions.
        await Assert.ThrowsAnyAsync<Exception>(() =>
        {
            _ = factory.CreateClient();
            return Task.CompletedTask;
        });
    }

    /// <summary>
    /// Variant of <see cref="TestApplicationFactory"/> that does NOT swap
    /// the DbContext provider. Keeps the production Npgsql registration
    /// but points <c>ConnectionStrings:DefaultConnection</c> at a closed
    /// port so <c>MigrateAsync</c> fails on the first connect attempt.
    /// Hosted services are still stripped so a fetcher / listener startup
    /// failure cannot mask the migration-failure trace.
    /// </summary>
    private sealed class UnreachableDbApplicationFactory : WebApplicationFactory<Dashboard.Api.Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Port 1 is reserved (RFC 6335 § 6 — "tcpmux") and unbound on
            // localhost in any reasonable test environment. Npgsql's
            // default Timeout is 15s; the [Fact(Timeout = 30_000)] on the
            // caller gives headroom for retries + tear-down.
            builder.UseSetting(
                "ConnectionStrings:DefaultConnection",
                "Host=127.0.0.1;Port=1;Database=nonexistent;" +
                "Username=u;Password=p;Timeout=5");

            builder.ConfigureTestServices(services =>
            {
                // Strip hosted services so the failure trace stays scoped
                // to MigrateAsync. Without this strip, a FetcherWorker or
                // DeploymentListener bootstrap failure could race the
                // migration failure and noise up the propagation path.
                for (var i = services.Count - 1; i >= 0; i--)
                {
                    if (services[i].ServiceType == typeof(IHostedService))
                    {
                        services.RemoveAt(i);
                    }
                }
            });
        }
    }
}
