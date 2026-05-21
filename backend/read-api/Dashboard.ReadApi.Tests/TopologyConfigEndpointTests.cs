using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Security;
using Dashboard.Shared.Topology;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// Covers SAD §7 "GET /api/config/topology" and "PATCH /api/config/topology":
/// PATCH semantics (unset fields unchanged, null removes), 400 on invalid
/// attribute, 401 on missing key.
///
/// <para>The Phase-1 SAD revision removed the <c>AllowUserOverride</c>
/// kill-switch — the SPA cannot write to the API at all (it carries no
/// <c>X-Api-Key</c>). PATCH stays in the API for admin / CI / ops tooling
/// (SAD §7: "<strong>admin / CI / ops tooling only — not invoked by the
/// SPA</strong>"). There is no longer a <c>403 Forbidden</c> branch.</para>
///
/// <para>The wire shape of these endpoints uses camelCase keys
/// (<c>correlationAttribute</c>, <c>perServiceOverrides</c>) — per SAD §7.
/// The tests therefore send raw JSON literals; using
/// <see cref="JsonContent.Create"/> with the global snake_case naming policy
/// would mangle the keys.</para>
/// </summary>
public sealed class TopologyConfigEndpointTests
{
    // Shared key — module initialiser (TestBootstrap) pins API_TOKEN once
    // per process so parallel test classes don't race the env var.
    private const string ApiKey = TestBootstrap.ApiKey;

    private static TopologyApiFactory NewFactory() => new();

    private static HttpRequestMessage WithApiKey(HttpRequestMessage req)
    {
        req.Headers.Add(ApiKeyMiddleware.HeaderName, ApiKey);
        return req;
    }

    private static HttpRequestMessage PatchJson(string rawBody) =>
        new(HttpMethod.Patch, "/api/config/topology")
        {
            Content = new StringContent(rawBody, Encoding.UTF8, "application/json"),
        };

    // ---------- GET — no auth, default config ---------------------------

    [Fact]
    public async Task Get_TopologyConfig_NoAuth_ReturnsBootstrapDefaults()
    {
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/config/topology");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var dto = await resp.Content.ReadFromJsonAsync<TopologyConfigDto>(DashboardJson.Options);
        Assert.NotNull(dto);
        Assert.Equal("version", dto!.CorrelationAttribute);
        Assert.Empty(dto.PerServiceOverrides);
    }

    [Fact]
    public async Task Get_TopologyConfig_DoesNotExposeAllowUserOverrideKey()
    {
        // Phase-1 SAD revision: the AllowUserOverride toggle was removed
        // from the wire because the SPA is read-only against the API and
        // never invokes PATCH. The key must not appear on the wire.
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/config/topology");
        var raw = await resp.Content.ReadAsStringAsync();

        Assert.DoesNotContain("allowUserOverride", raw);
        Assert.DoesNotContain("AllowUserOverride", raw);
    }

    // ---------- PATCH — auth required -----------------------------------

    [Fact]
    public async Task Patch_TopologyConfig_MissingApiKey_Returns401()
    {
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.SendAsync(PatchJson(
            """{ "correlationAttribute": "actor" }"""));

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Patch_TopologyConfig_UpdatesCorrelationAttribute()
    {
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.SendAsync(WithApiKey(PatchJson(
            """{ "correlationAttribute": "actor" }""")));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var dto = await resp.Content.ReadFromJsonAsync<TopologyConfigDto>(DashboardJson.Options);
        Assert.Equal("actor", dto!.CorrelationAttribute);

        // Persisted across reads.
        var getResp = await client.GetAsync("/api/config/topology");
        var afterGet = await getResp.Content.ReadFromJsonAsync<TopologyConfigDto>(DashboardJson.Options);
        Assert.Equal("actor", afterGet!.CorrelationAttribute);
    }

    [Fact]
    public async Task Patch_TopologyConfig_UnsetFieldsAreLeftUnchanged()
    {
        // SAD: "Either or both of the following fields may be set in a
        // single request. Unset fields are left unchanged."
        using var factory = NewFactory();
        var client = factory.CreateClient();

        // Establish a non-default starting state.
        await client.SendAsync(WithApiKey(PatchJson("""
        {
          "correlationAttribute": "run",
          "perServiceOverrides": { "svc-x": "sha" }
        }
        """)));

        // Patch only perServiceOverrides — correlationAttribute must persist.
        await client.SendAsync(WithApiKey(PatchJson("""
        {
          "perServiceOverrides": { "svc-y": "actor" }
        }
        """)));

        var resp = await client.GetAsync("/api/config/topology");
        var dto = await resp.Content.ReadFromJsonAsync<TopologyConfigDto>(DashboardJson.Options);
        Assert.Equal("run", dto!.CorrelationAttribute);
        Assert.True(dto.PerServiceOverrides.ContainsKey("svc-x"));
        Assert.Equal("sha", dto.PerServiceOverrides["svc-x"]);
        Assert.Equal("actor", dto.PerServiceOverrides["svc-y"]);
    }

    [Fact]
    public async Task Patch_TopologyConfig_NullValueRemovesPerServiceOverride()
    {
        // SAD PATCH body table: "null removes the override for that service".
        using var factory = NewFactory();
        var client = factory.CreateClient();

        await client.SendAsync(WithApiKey(PatchJson("""
        {
          "perServiceOverrides": {
            "svc-x": "sha",
            "svc-y": "actor"
          }
        }
        """)));

        // Send null for svc-x to remove it; leave svc-y alone.
        var resp = await client.SendAsync(WithApiKey(PatchJson("""
        {
          "perServiceOverrides": { "svc-x": null }
        }
        """)));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var dto = await resp.Content.ReadFromJsonAsync<TopologyConfigDto>(DashboardJson.Options);
        Assert.False(dto!.PerServiceOverrides.ContainsKey("svc-x"));
        Assert.True(dto.PerServiceOverrides.ContainsKey("svc-y"));
    }

    [Fact]
    public async Task Patch_TopologyConfig_InvalidAttribute_Returns400()
    {
        // SAD: "Rejected with 400 if not in this set or if `id` is supplied".
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.SendAsync(WithApiKey(PatchJson(
            """{ "correlationAttribute": "id" }""")));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_correlation_attribute", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Patch_TopologyConfig_UnknownAttribute_Returns400()
    {
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.SendAsync(WithApiKey(PatchJson(
            """{ "correlationAttribute": "not-a-real-attribute" }""")));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }
}

/// <summary>
/// Dedicated factory variant for topology-config endpoint tests. Identical
/// to the matrix factory but kept separate so each set of tests can evolve
/// its DI overrides independently.
///
/// <para>Carries the same ADR-0009 accommodations as
/// <see cref="TestApplicationFactory"/> (PendingModelChangesWarning
/// suppression + __EFMigrationsHistory pre-seed); see that type's remarks
/// for the diagnostic write-up.</para>
/// </summary>
internal sealed class TopologyApiFactory : WebApplicationFactory<Dashboard.Api.Program>
{
    private SqliteConnection? _sqlite;

    // Kept in sync with TestApplicationFactory.KnownMigrations + the sister
    // copies in Dashboard.Api.Tests / Dashboard.WriteApi.Tests; see those
    // files for the rationale on inlining over a shared helper.
    private static readonly string[] KnownMigrations =
    {
        "20260514154415_CreateDeploymentsTable",
        "20260515120000_AddTopologyColumnsAndConfig",
        "20260515160000_AddRefAndShaColumns",
        "20260518120000_AddProgressReporterAndFetcherState",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("ConnectionStrings:DefaultConnection",
            "Host=placeholder;Database=test;Username=test;Password=test");

        builder.ConfigureTestServices(services =>
        {
            // Wipe the production DbContext registration before adding the
            // SQLite-in-memory one.
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
                // Provider-metadata diff (Npgsql snapshot ↔ sqlite test
                // provider) is a false-positive, not real model drift —
                // verified via `dotnet ef migrations
                // has-pending-model-changes`.
                .ConfigureWarnings(w => w.Ignore(
                    RelationalEventId.PendingModelChangesWarning)));

            // Strip hosted services (LISTEN / pruning) — neither has a real
            // Postgres to talk to.
            for (var i = services.Count - 1; i >= 0; i--)
            {
                if (services[i].ServiceType == typeof(IHostedService))
                {
                    services.RemoveAt(i);
                }
            }

            // Pre-stage the database state BEFORE the ADR-0009 startup
            // hook fires: EnsureCreated materialises the model snapshot
            // into sqlite-compatible DDL, then __EFMigrationsHistory is
            // seeded so MigrateAsync sees nothing pending and exits as a
            // no-op.
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
