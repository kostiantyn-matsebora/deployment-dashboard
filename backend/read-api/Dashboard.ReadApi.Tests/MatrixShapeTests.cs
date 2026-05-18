using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// SAD §7 "Matrix response shape — per service" — verify the wire format
/// the SPA reads:
/// <code>
/// {
///   "service-a": {
///     "envs": { "dev": { current, lastSuccessful, previousFailed } },
///     "topology": { "edges": [ { from, to, source } ] }
///   }
/// }
/// </code>
/// </summary>
public sealed class MatrixShapeTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public MatrixShapeTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.RemoveRange(db.Deployments);
        db.SaveChanges();
    }

    private static int _id;

    private static DeploymentEntity D(
        string env,
        string version,
        DateTime at,
        string service = "svc-a",
        string status = DeploymentStatus.Success,
        string? deploymentId = null,
        IReadOnlyList<string>? parents = null,
        string? @ref = null,
        string? sha = null) => new()
        {
            DeploymentId = deploymentId ?? $"d-{Interlocked.Increment(ref _id)}",
            Service = service,
            Environment = env,
            Version = version,
            Status = status,
            RunUrl = "https://example.com/runs/1",
            RunNumber = 1,
            Actor = "tester",
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            ParentDeployments = parents?.ToList() ?? new List<string>(),
            Ref = @ref,
            Sha = sha,
        };

    [Fact]
    public async Task Get_Matrix_ReturnsPerServiceWrapperWithEnvsAndTopology()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), deploymentId: "p"));
            db.Deployments.Add(D("qa", "v1", new DateTime(2026, 5, 14, 11, 0, 0),
                deploymentId: "q", parents: new[] { "p" }));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("svc-a", out var svc));
        Assert.True(svc.TryGetProperty("envs", out var envs));
        Assert.True(envs.TryGetProperty("dev", out _));
        Assert.True(envs.TryGetProperty("qa", out _));
        Assert.True(svc.TryGetProperty("topology", out var topology));
        var edges = topology.GetProperty("edges").EnumerateArray().ToList();

        var explicitEdge = edges.Single();
        Assert.Equal("dev", explicitEdge.GetProperty("from").GetString());
        Assert.Equal("qa", explicitEdge.GetProperty("to").GetString());
        Assert.Equal("explicit", explicitEdge.GetProperty("source").GetString());
    }

    [Fact]
    public async Task Get_Matrix_EmptyTopology_StillPresentAsEmptyEdgesArray()
    {
        // SAD field rules: "topology.edges is always present (possibly
        // empty) per service".
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0), service: "lone"));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var topology = body.GetProperty("lone").GetProperty("topology");
        var edges = topology.GetProperty("edges").EnumerateArray().ToList();
        Assert.Empty(edges);
    }

    [Fact]
    public async Task Get_Matrix_Current_CarriesRefAndSha_WhenPopulated()
    {
        // FR-05 + SAD §7: ref/sha surface on current. Always-emit
        // convention — populated when stored value is non-null.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0),
                deploymentId: "rs-current",
                @ref: "feature/login-revamp",
                sha: "9f1c0d2e8a"));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var current = body.GetProperty("svc-a").GetProperty("envs").GetProperty("dev").GetProperty("current");

        Assert.Equal("feature/login-revamp", current.GetProperty("ref").GetString());
        Assert.Equal("9f1c0d2e8a", current.GetProperty("sha").GetString());
    }

    [Fact]
    public async Task Get_Matrix_Current_EmitsNullRefAndSha_WhenAbsent()
    {
        // SAD §7 field rules: server MAY omit OR emit null when stored
        // value is null. We adopted the always-emit-null convention so the
        // SPA can rely on a stable shape — assert that here.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0)));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var current = body.GetProperty("svc-a").GetProperty("envs").GetProperty("dev").GetProperty("current");

        Assert.True(current.TryGetProperty("ref", out var refProp));
        Assert.True(current.TryGetProperty("sha", out var shaProp));
        Assert.Equal(JsonValueKind.Null, refProp.ValueKind);
        Assert.Equal(JsonValueKind.Null, shaProp.ValueKind);
    }

    [Fact]
    public async Task Get_Matrix_LastSuccessful_CarriesRefAndSha_WhenPopulated()
    {
        // SAD §7 field rules + JSON example: lastSuccessful also carries
        // ref/sha. Seed an in-progress current over an older success, then
        // assert the older success surfaces in lastSuccessful with its
        // stored ref/sha values.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v2", new DateTime(2026, 5, 14, 14, 0, 0),
                deploymentId: "rs-current-ip", status: DeploymentStatus.InProgress));
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 13, 14, 0, 0),
                deploymentId: "rs-last-success",
                @ref: "main",
                sha: "deadbeef01"));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var slot = body.GetProperty("svc-a").GetProperty("envs").GetProperty("dev");
        var last = slot.GetProperty("lastSuccessful");

        Assert.Equal("main", last.GetProperty("ref").GetString());
        Assert.Equal("deadbeef01", last.GetProperty("sha").GetString());
    }

    [Fact]
    public async Task Get_Slot_SingleEndpoint_CarriesRefAndSha()
    {
        // SAD line 892: single-slot endpoint follows the same per-event
        // shape as the matrix, including ref/sha.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0),
                service: "single-slot",
                @ref: "feature/x",
                sha: "abc1234"));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments/single-slot/dev");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var current = body.GetProperty("current");
        Assert.Equal("feature/x", current.GetProperty("ref").GetString());
        Assert.Equal("abc1234", current.GetProperty("sha").GetString());
    }

    [Fact]
    public async Task Get_Matrix_CurrentCarriesDeploymentIdAndParentDeployments()
    {
        // SAD: "current.deployment_id and current.parent_deployments are
        // surfaced on the wire so the SPA can render explicit parent links".
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.Add(D("dev", "v1", new DateTime(2026, 5, 14, 10, 0, 0),
                deploymentId: "shape-current",
                parents: new[] { "shape-parent" }));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var current = body.GetProperty("svc-a").GetProperty("envs").GetProperty("dev").GetProperty("current");

        Assert.Equal("shape-current", current.GetProperty("deployment_id").GetString());
        var parents = current.GetProperty("parent_deployments").EnumerateArray()
            .Select(e => e.GetString()).ToArray();
        Assert.Equal(new[] { "shape-parent" }, parents);
    }
}
