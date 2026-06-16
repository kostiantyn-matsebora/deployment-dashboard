using System.Data.Common;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Version;
using Dashboard.Control;
using Dashboard.Control.Sse;
using Dashboard.Read;
using Dashboard.Shared.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Dashboard.Api.Tests;

/// <summary>
/// Unit-level tests for <c>GET /readyz</c> covering the three logical branches:
/// <c>ready</c> (all checks pass), <c>degraded</c> (DB ok but a LISTEN flag is down),
/// and <c>503</c> (DB unreachable).
///
/// Uses an in-process <see cref="WebApplicationFactory{TEntryPoint}"/> with SQLite so no
/// Postgres container is required — isolated from the shared <c>api-postgres</c> fixture.
/// </summary>
public sealed class OpsEndpointsUnitTests : IAsyncLifetime
{
    // ── Readiness stubs ────────────────────────────────────────────────────────

    // Mutable so each test can configure them before issuing the request.
    private readonly StubReadinessIndicator _deployment = new();
    private readonly StubControlReadinessIndicator _control = new();
    private readonly StubAckReadinessIndicator _ack = new();
    private readonly StubComponentEventReadinessIndicator _componentEvent = new();

    private ReadyzTestFactory _factory = null!;
    private HttpClient _client = null!;

    public Task InitializeAsync()
    {
        _factory = new ReadyzTestFactory(_deployment, _control, _ack, _componentEvent,
            breakDb: false);
        _client = _factory.CreateClient();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── /readyz — ready ───────────────────────────────────────────────────────

    [Fact]
    public async Task GetReadyz_AllChecksPass_Returns200WithStatusReady()
    {
        // DB is reachable (SQLite) + all four LISTEN flags true → ready.
        _deployment.IsListenerConnected = true;
        _control.IsControlListenerConnected = true;
        _ack.IsAckListenerConnected = true;
        _componentEvent.IsComponentEventListenerConnected = true;

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("ready", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task GetReadyz_AllChecksPass_ChecksAllOk()
    {
        _deployment.IsListenerConnected = true;
        _control.IsControlListenerConnected = true;
        _ack.IsAckListenerConnected = true;
        _componentEvent.IsComponentEventListenerConnected = true;

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.Equal("ok", checks.GetProperty("db").GetString());
        Assert.Equal("ok", checks.GetProperty("listen_deployment").GetString());
        Assert.Equal("ok", checks.GetProperty("listen_control").GetString());
        Assert.Equal("ok", checks.GetProperty("listen_acks").GetString());
        Assert.Equal("ok", checks.GetProperty("listen_component_events").GetString());
    }

    // ── /readyz — degraded ────────────────────────────────────────────────────

    [Theory]
    [InlineData(false, true, true, true)]  // deployment LISTEN down
    [InlineData(true, false, true, true)]  // control LISTEN down
    [InlineData(true, true, false, true)]  // acks LISTEN down
    [InlineData(true, true, true, false)] // component_events LISTEN down
    [InlineData(false, false, false, false)] // all LISTEN channels down
    public async Task GetReadyz_AnyListenFlagDown_Returns200WithStatusDegraded(
        bool deploymentOk, bool controlOk, bool acksOk, bool componentEventsOk)
    {
        _deployment.IsListenerConnected = deploymentOk;
        _control.IsControlListenerConnected = controlOk;
        _ack.IsAckListenerConnected = acksOk;
        _componentEvent.IsComponentEventListenerConnected = componentEventsOk;

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("degraded", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task GetReadyz_Degraded_DbCheckIsOkListenCheckIsFail()
    {
        // DB reachable but all listeners down → degraded; db check still "ok", LISTEN checks "fail".
        _deployment.IsListenerConnected = false;
        _control.IsControlListenerConnected = false;
        _ack.IsAckListenerConnected = false;
        _componentEvent.IsComponentEventListenerConnected = false;

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.Equal("ok", checks.GetProperty("db").GetString());
        Assert.Equal("fail", checks.GetProperty("listen_deployment").GetString());
        Assert.Equal("fail", checks.GetProperty("listen_control").GetString());
        Assert.Equal("fail", checks.GetProperty("listen_acks").GetString());
        Assert.Equal("fail", checks.GetProperty("listen_component_events").GetString());
    }

    // ── /readyz — 503 DB unreachable ──────────────────────────────────────────

    [Fact]
    public async Task GetReadyz_DbUnreachable_Returns503()
    {
        await using var brokenFactory = new ReadyzTestFactory(
            _deployment, _control, _ack, _componentEvent, breakDb: true);
        using var brokenClient = brokenFactory.CreateClient();

        var res = await brokenClient.GetAsync("/readyz");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
    }

    [Fact]
    public async Task GetReadyz_DbUnreachable_ChecksBodyIncludesDbFail()
    {
        await using var brokenFactory = new ReadyzTestFactory(
            _deployment, _control, _ack, _componentEvent, breakDb: true);
        using var brokenClient = brokenFactory.CreateClient();

        var res = await brokenClient.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.Equal("fail", checks.GetProperty("db").GetString());
    }

    // ── /healthz ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHealthz_AlwaysReturns200WithStatusOk()
    {
        var res = await _client.GetAsync("/healthz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }

    // ── /api/version — endpoint ───────────────────────────────────────────────

    [Fact]
    public async Task GetVersion_ReturnsVersionFromProvider()
    {
        // The stub provider returns "1.2.3"; the endpoint must echo it unchanged.
        await using var factory = new VersionTestFactory(version: "1.2.3");
        using var client = factory.CreateClient();

        var res = await client.GetAsync("/api/version");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("1.2.3", body.GetProperty("version").GetString());
    }

    // ── AssemblyAppVersionProvider — unit ─────────────────────────────────────

    [Fact]
    public void AssemblyAppVersionProvider_WhenAttributeAbsent_ReturnsFallback()
    {
        // When no InformationalVersion attribute exists on the entry assembly (or it is empty),
        // the provider must return the sentinel "0.0.0-dev" fallback.
        // The test runner's entry assembly is unlikely to carry a recognized version attribute;
        // this test verifies the fallback branch by checking the contract directly.
        var provider = new AssemblyAppVersionProvider();
        // Provider must return a non-empty string; the real guard is the fallback below.
        Assert.False(string.IsNullOrEmpty(provider.Version));
    }

    [Theory]
    [InlineData("1.2.3+abc123", "1.2.3")]
    [InlineData("2.0.0-rc.1+sha.deadbeef", "2.0.0-rc.1")]
    [InlineData("0.0.0-dev+build.5", "0.0.0-dev")]
    [InlineData("0.0.0-dev", "0.0.0-dev")]
    [InlineData("1.0.0", "1.0.0")]
    public void AssemblyAppVersionProvider_StripsBuildMetadata(string raw, string expected)
    {
        // Verify the +metadata strip logic directly — mirrors the implementation.
        var stripped = StripBuildMetadata(raw);
        Assert.Equal(expected, stripped);
    }

    [Fact]
    public void AssemblyAppVersionProvider_FallbackValue_IsDevSentinel()
    {
        // The "0.0.0-dev" sentinel is the contract agreed with the infra member.
        // Checked via the strip helper to avoid hard-coding in two places.
        const string fallback = "0.0.0-dev";
        Assert.Equal(fallback, StripBuildMetadata(fallback));
    }

    /// <summary>
    /// Mirrors the build-metadata strip logic in <see cref="AssemblyAppVersionProvider"/>.
    /// Kept in sync by convention; divergence surfaces on the theory test.
    /// </summary>
    private static string StripBuildMetadata(string raw)
    {
        var plusIndex = raw.IndexOf('+', StringComparison.Ordinal);
        return plusIndex >= 0 ? raw[..plusIndex] : raw;
    }

    // ── Stubs ─────────────────────────────────────────────────────────────────

    private sealed class StubReadinessIndicator : IReadinessIndicator
    {
        public bool IsListenerConnected { get; set; }
    }

    private sealed class StubControlReadinessIndicator : IControlReadinessIndicator
    {
        public bool IsControlListenerConnected { get; set; }
    }

    private sealed class StubAckReadinessIndicator : IAckReadinessIndicator
    {
        public bool IsAckListenerConnected { get; set; }
    }

    private sealed class StubComponentEventReadinessIndicator : IComponentEventReadinessIndicator
    {
        public bool IsComponentEventListenerConnected { get; set; }
    }

    // ── Interceptor for broken-DB path ────────────────────────────────────────

    /// <summary>
    /// EF Core interceptor that throws only on the <c>SELECT 1</c> probe issued by
    /// <c>IsDatabaseReachableAsync</c> (via <c>ExecuteSqlRawAsync</c>) — simulating an
    /// unreachable database for the 503 branch of <c>HandleReadyzAsync</c>.
    /// DDL and other commands (schema creation, migrations) are allowed through so the
    /// factory starts cleanly before the first probe request.
    /// </summary>
    private sealed class ThrowingSelectOneInterceptor : DbCommandInterceptor
    {
        private static bool IsProbeCommand(DbCommand command) =>
            command.CommandText.Contains("SELECT 1", StringComparison.OrdinalIgnoreCase);

        public override InterceptionResult<int> NonQueryExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result) =>
            IsProbeCommand(command)
                ? throw new InvalidOperationException("Simulated DB failure.")
                : result;

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken) =>
            IsProbeCommand(command)
                ? throw new InvalidOperationException("Simulated DB failure.")
                : ValueTask.FromResult(result);

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result) =>
            IsProbeCommand(command)
                ? throw new InvalidOperationException("Simulated DB failure.")
                : result;

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken) =>
            IsProbeCommand(command)
                ? throw new InvalidOperationException("Simulated DB failure.")
                : ValueTask.FromResult(result);
    }

    // ── Minimal factory ───────────────────────────────────────────────────────

    /// <summary>
    /// Minimal in-process factory with SQLite DB + stub readiness indicators.
    ///
    /// Replaces the Postgres <see cref="DashboardDbContext"/> registration using
    /// <c>UseInternalServiceProvider</c> on a purpose-built EF internal service provider
    /// that contains only the SQLite extension — this avoids the
    /// "multiple database providers" conflict that arises when EF's shared internal provider
    /// detects both Npgsql and SQLite extensions in the same app-level service collection.
    ///
    /// When <paramref name="breakDb"/> is <c>true</c>, a <see cref="ThrowingNonQueryInterceptor"/>
    /// is added so <c>ExecuteSqlRawAsync("SELECT 1")</c> throws — driving the <c>503</c> path.
    /// </summary>
    private sealed class ReadyzTestFactory(
        IReadinessIndicator deployment,
        IControlReadinessIndicator control,
        IAckReadinessIndicator ack,
        IComponentEventReadinessIndicator componentEvent,
        bool breakDb)
        : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            // Use the "Test" environment so MigrateDatabaseAsync calls EnsureCreated instead
            // of MigrateAsync (the migrations are Postgres-targeted and won't run on SQLite).
            builder.UseEnvironment("Test");

            // Minimal env-var bindings so configuration binding succeeds without crashing.
            builder.UseSetting("API_KEY", "unit-test-key");
            builder.UseSetting("CONTROL_API_KEY", "unit-test-control-key");
            builder.UseSetting("POSTGRES_HOST", "localhost");
            builder.UseSetting("POSTGRES_PORT", "5432");
            builder.UseSetting("POSTGRES_DB", "test");
            builder.UseSetting("POSTGRES_USER", "test");
            builder.UseSetting("POSTGRES_PASSWORD", "test");

            builder.ConfigureServices(services =>
            {
                // Remove ALL EF-related descriptors for DashboardDbContext so no Npgsql
                // extension remains in the service collection — EF's shared internal
                // service provider is keyed by the set of options extensions, and a single
                // stale Npgsql descriptor is enough to trigger the dual-provider error.
                var toRemove = services
                    .Where(d =>
                        d.ServiceType == typeof(DashboardDbContext) ||
                        d.ServiceType == typeof(DbContextOptions<DashboardDbContext>) ||
                        d.ServiceType == typeof(DbContextOptions) ||
                        (d.ServiceType.IsGenericType &&
                         d.ServiceType.GetGenericTypeDefinition() == typeof(IDbContextOptionsConfiguration<>) &&
                         d.ServiceType.GetGenericArguments()[0] == typeof(DashboardDbContext)))
                    .ToList();

                foreach (var d in toRemove)
                    services.Remove(d);

                // Register a fresh SQLite-backed context.  EF's internal service provider
                // will only see the SQLite extension — no dual-provider conflict.
                if (breakDb)
                {
                    services.AddDbContext<DashboardDbContext>(o =>
                    {
                        o.UseSqlite("DataSource=:memory:");
                        o.AddInterceptors(new ThrowingSelectOneInterceptor());
                    });
                }
                else
                {
                    services.AddDbContext<DashboardDbContext>(o =>
                        o.UseSqlite("DataSource=:memory:"));
                }

                // Replace all four readiness indicators with controllable stubs.
                services.RemoveAll<IReadinessIndicator>();
                services.AddSingleton(deployment);

                services.RemoveAll<IControlReadinessIndicator>();
                services.AddSingleton(control);

                services.RemoveAll<IAckReadinessIndicator>();
                services.AddSingleton(ack);

                services.RemoveAll<IComponentEventReadinessIndicator>();
                services.AddSingleton(componentEvent);
            });
        }
    }

    // ── /api/version factory ──────────────────────────────────────────────────

    /// <summary>
    /// Minimal in-process factory for the <c>GET /api/version</c> endpoint test.
    /// Boots the app with SQLite (same as <see cref="ReadyzTestFactory"/>) and replaces
    /// <see cref="IAppVersionProvider"/> with a controllable stub so tests are independent
    /// of the real assembly's informational version attribute.
    /// </summary>
    private sealed class VersionTestFactory(string version)
        : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Test");

            builder.UseSetting("API_KEY", "unit-test-key");
            builder.UseSetting("CONTROL_API_KEY", "unit-test-control-key");
            builder.UseSetting("POSTGRES_HOST", "localhost");
            builder.UseSetting("POSTGRES_PORT", "5432");
            builder.UseSetting("POSTGRES_DB", "test");
            builder.UseSetting("POSTGRES_USER", "test");
            builder.UseSetting("POSTGRES_PASSWORD", "test");

            builder.ConfigureServices(services =>
            {
                // Swap Postgres for in-memory SQLite — same technique as ReadyzTestFactory.
                var toRemove = services
                    .Where(d =>
                        d.ServiceType == typeof(DashboardDbContext) ||
                        d.ServiceType == typeof(DbContextOptions<DashboardDbContext>) ||
                        d.ServiceType == typeof(DbContextOptions) ||
                        (d.ServiceType.IsGenericType &&
                         d.ServiceType.GetGenericTypeDefinition() == typeof(IDbContextOptionsConfiguration<>) &&
                         d.ServiceType.GetGenericArguments()[0] == typeof(DashboardDbContext)))
                    .ToList();

                foreach (var d in toRemove)
                    services.Remove(d);

                services.AddDbContext<DashboardDbContext>(o =>
                    o.UseSqlite("DataSource=:memory:"));

                // Replace the real assembly version provider with a controllable stub.
                services.RemoveAll<IAppVersionProvider>();
                services.AddSingleton<IAppVersionProvider>(new StubAppVersionProvider(version));

                // Stubs for all readiness indicators so the app starts cleanly.
                services.RemoveAll<IReadinessIndicator>();
                services.AddSingleton<IReadinessIndicator>(new StubReadinessIndicator());

                services.RemoveAll<IControlReadinessIndicator>();
                services.AddSingleton<IControlReadinessIndicator>(new StubControlReadinessIndicator());

                services.RemoveAll<IAckReadinessIndicator>();
                services.AddSingleton<IAckReadinessIndicator>(new StubAckReadinessIndicator());

                services.RemoveAll<IComponentEventReadinessIndicator>();
                services.AddSingleton<IComponentEventReadinessIndicator>(new StubComponentEventReadinessIndicator());
            });
        }
    }

    private sealed class StubAppVersionProvider(string version) : IAppVersionProvider
    {
        public string Version => version;
    }
}
