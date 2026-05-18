using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Security;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// SAD §7 "GET /api/deployments — query parameters". Covers:
///
/// <list type="bullet">
///   <item>Allowed values produce edges per the resolved attribute
///   (per-request override beats the server default).</item>
///   <item><c>id</c> is explicitly disallowed (SAD: "<c>id</c> is
///   disallowed. Invalid value → 400 Bad Request.").</item>
///   <item>Per-service override beats the query parameter (SAD
///   "Per-service overrides win regardless").</item>
///   <item>Absence falls back to the server-side default.</item>
/// </list>
///
/// <para>Each test owns its own <see cref="TopologyApiFactory"/> so DB
/// state and topology-config mutations don't leak between tests. The
/// pattern mirrors <see cref="TopologyConfigEndpointTests"/> — neither
/// shares a <c>WebApplicationFactory</c> via <c>IClassFixture</c>.</para>
/// </summary>
public sealed class CorrelationAttributeQueryParamTests
{
    // Shared key — module initialiser (TestBootstrap) pins API_TOKEN once
    // per process so parallel test classes don't race the env var.
    private const string ApiKey = TestBootstrap.ApiKey;

    private static TopologyApiFactory NewFactory() => new();

    private static int _id;

    private static DeploymentEntity D(
        string service,
        string env,
        string version,
        DateTime at,
        string actor = "tester",
        IReadOnlyList<string>? parents = null) => new()
        {
            DeploymentId = $"d-{Interlocked.Increment(ref _id)}",
            Service = service,
            Environment = env,
            Version = version,
            Status = DeploymentStatus.Success,
            RunUrl = "https://example.com/runs/1",
            RunNumber = 1,
            Actor = actor,
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            ParentDeployments = parents?.ToList() ?? new List<string>(),
        };

    private static async Task SeedAsync(TopologyApiFactory factory, params DeploymentEntity[] events)
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.AddRange(events);
        await db.SaveChangesAsync();
    }

    // ---------- happy path: ?correlationAttribute=actor -----------------

    [Fact]
    public async Task Get_Matrix_WithActorOverride_DerivesEdgesByActor()
    {
        // Two deployments with DIFFERENT versions but the SAME actor. Under
        // the default `version` correlation no edge forms (the versions
        // differ); under `?correlationAttribute=actor` an edge dev -> qa
        // is emitted because the actors match. This is the wire-level proof
        // that the query parameter actually flows through to the builder.
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory,
            D("svc-a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), actor: "ada"),
            D("svc-a", "qa", "v2", new DateTime(2026, 5, 14, 11, 0, 0), actor: "ada"));

        // Without override: no edges (versions differ).
        var defaultResp = await client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, defaultResp.StatusCode);
        var defaultBody = await defaultResp.Content.ReadFromJsonAsync<JsonElement>();
        var defaultEdges = defaultBody.GetProperty("svc-a").GetProperty("topology")
            .GetProperty("edges").EnumerateArray().ToList();
        Assert.Empty(defaultEdges);

        // With override: one correlated edge.
        var overrideResp = await client.GetAsync("/api/deployments?correlationAttribute=actor");
        Assert.Equal(HttpStatusCode.OK, overrideResp.StatusCode);
        var overrideBody = await overrideResp.Content.ReadFromJsonAsync<JsonElement>();
        var overrideEdges = overrideBody.GetProperty("svc-a").GetProperty("topology")
            .GetProperty("edges").EnumerateArray().ToList();

        var edge = Assert.Single(overrideEdges);
        Assert.Equal("dev", edge.GetProperty("from").GetString());
        Assert.Equal("qa", edge.GetProperty("to").GetString());
        Assert.Equal("correlated", edge.GetProperty("source").GetString());
    }

    // ---------- ?correlationAttribute=id → 400 --------------------------

    [Fact]
    public async Task Get_Matrix_WithIdAttribute_Returns400()
    {
        // SAD §7 "GET /api/deployments — query parameters":
        // "Allowed values: version, ref, sha, actor, run, ago. `id` is
        // disallowed. Invalid value → 400 Bad Request."
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/deployments?correlationAttribute=id");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_correlation_attribute", body.GetProperty("error").GetString());
        Assert.Equal("id", body.GetProperty("attribute").GetString());
    }

    [Fact]
    public async Task Get_Matrix_WithUnknownAttribute_Returns400()
    {
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/deployments?correlationAttribute=not-a-thing");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Theory]
    [InlineData("version")]
    [InlineData("ref")]
    [InlineData("sha")]
    [InlineData("actor")]
    [InlineData("run")]
    [InlineData("ago")]
    public async Task Get_Matrix_WithAllowedAttribute_Returns200(string attribute)
    {
        // Every SAD-allowed attribute must be accepted (200 OK). The body
        // shape is the standard matrix wrapper.
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory, D("svc-a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)));

        var resp = await client.GetAsync($"/api/deployments?correlationAttribute={attribute}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("svc-a", out _));
    }

    // ---------- per-service override beats query parameter --------------

    [Fact]
    public async Task Get_Matrix_PerServiceOverride_BeatsQueryParam()
    {
        // SAD §7 "GET /api/deployments — query parameters":
        // "Per-service overrides win regardless: if
        // Topology.PerServiceOverrides[service] is set ... that attribute is
        // used for `service` even when the request supplies a different
        // correlationAttribute."
        //
        // Wire `svc-a` -> per-service override `actor`. Deployments share an
        // actor but have different versions. Request `?correlationAttribute=version`
        // should be IGNORED for svc-a: the per-service override wins, so the
        // actor-based edge still forms.
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory,
            D("svc-a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), actor: "ada"),
            D("svc-a", "qa", "v2", new DateTime(2026, 5, 14, 11, 0, 0), actor: "ada"));

        var patch = new HttpRequestMessage(HttpMethod.Patch, "/api/config/topology")
        {
            Content = new StringContent(
                """{ "perServiceOverrides": { "svc-a": "actor" } }""",
                Encoding.UTF8,
                "application/json"),
        };
        patch.Headers.Add(ApiKeyMiddleware.HeaderName, ApiKey);
        var patchResp = await client.SendAsync(patch);
        Assert.Equal(HttpStatusCode.OK, patchResp.StatusCode);

        // Request `version` — the per-service override `actor` must win.
        var resp = await client.GetAsync("/api/deployments?correlationAttribute=version");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var edges = body.GetProperty("svc-a").GetProperty("topology")
            .GetProperty("edges").EnumerateArray().ToList();

        var edge = Assert.Single(edges);
        Assert.Equal("dev", edge.GetProperty("from").GetString());
        Assert.Equal("qa", edge.GetProperty("to").GetString());
        Assert.Equal("correlated", edge.GetProperty("source").GetString());
    }

    // ---------- absent parameter falls back to server default -----------

    [Fact]
    public async Task Get_Matrix_NoQueryParam_FallsBackToServerDefault()
    {
        // SAD §7: "Omitted → falls back to the server-side default
        // (Topology.CorrelationAttribute)." Default is `version`; two
        // matching-version deployments produce a correlated edge.
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory,
            D("svc-a", "dev", "v9", new DateTime(2026, 5, 14, 10, 0, 0)),
            D("svc-a", "qa", "v9", new DateTime(2026, 5, 14, 11, 0, 0)));

        var resp = await client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var edges = body.GetProperty("svc-a").GetProperty("topology")
            .GetProperty("edges").EnumerateArray().ToList();
        var edge = Assert.Single(edges);
        Assert.Equal("correlated", edge.GetProperty("source").GetString());
    }

    [Fact]
    public async Task Get_Matrix_EmptyParamValue_Returns400()
    {
        // SAD §7 "GET /api/deployments — query parameters" distinguishes
        // "Omitted → falls back to the server-side default" from "Invalid
        // value → 400 Bad Request". `?correlationAttribute=` is present-but-
        // empty: the parameter IS in the query string, just with no value.
        // The SAD enumerates the allowed values (version, ref, sha, actor,
        // run, ago); empty string is not one of them, so this is an invalid
        // value, not an omitted parameter. Must be 400, matching every other
        // invalid value (`id`, `zzz`, `VERSION`, `status`).
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory, D("svc-a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)));

        var resp = await client.GetAsync("/api/deployments?correlationAttribute=");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("invalid_correlation_attribute", body.GetProperty("error").GetString());
    }

    // ---------- slot endpoint accepts the parameter (but ignores it) ----

    [Fact]
    public async Task Get_Slot_WithCorrelationAttribute_StillReturns200()
    {
        // SAD §7: ".../{service}/{environment} accepts it but ignores it —
        // these endpoints do not return topology". Still: an invalid value
        // surfaces the same 400 so request-shape errors are uniform.
        using var factory = NewFactory();
        var client = factory.CreateClient();
        await SeedAsync(factory, D("svc-a", "dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)));

        var ok = await client.GetAsync("/api/deployments/svc-a/dev?correlationAttribute=actor");
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);

        var bad = await client.GetAsync("/api/deployments/svc-a/dev?correlationAttribute=id");
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
    }
}
