using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.ReadApi.Tests;

public sealed class EndpointSmokeTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public EndpointSmokeTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
        // The factory is shared across all tests in this class
        // (IClassFixture). Reset the table before each test so seeded data
        // from one test does not leak into discovery / matrix shape
        // assertions in the next test.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.RemoveRange(db.Deployments);
        db.SaveChanges();
    }

    private async Task SeedAsync(params DeploymentEntity[] events)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.AddRange(events);
        await db.SaveChangesAsync();
    }

    private static int _nextId;

    private static DeploymentEntity Evt(
        string s, string e, string v, string status, DateTime at, long run = 1,
        string? @ref = null, string? sha = null)
        => new()
        {
            DeploymentId = $"smoke-{Interlocked.Increment(ref _nextId)}",
            Service = s, Environment = e, Version = v, Status = status,
            RunUrl = $"https://example.com/r/{run}",
            RunNumber = run,
            Actor = "tester",
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            Ref = @ref,
            Sha = sha,
        };

    [Fact]
    public async Task Get_Matrix_ReturnsExpectedShape()
    {
        await SeedAsync(
            Evt("web-portal", "dev", "v2.3.2", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 34, 0), 1251),
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,    new DateTime(2026, 5, 14, 12, 30, 0), 1247));

        var resp = await _client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var json = await resp.Content.ReadAsStringAsync();
        Assert.Contains("\"web-portal\"", json);
        Assert.Contains("\"dev\"", json);
        Assert.Contains("\"current\"", json);
        Assert.Contains("\"lastSuccessful\"", json);
        Assert.Contains("\"previousFailed\"", json);
        Assert.Contains("\"run_url\"", json);
    }

    [Fact]
    public async Task Get_Slot_404_WhenSlotHasNoEvents()
    {
        var resp = await _client.GetAsync("/api/deployments/nope/dev");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Get_History_404_WhenSlotHasNoEvents()
    {
        var resp = await _client.GetAsync("/api/deployments/nope/dev/history");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Get_History_HappyPath_OrdersNewestFirst_AndRespectsLimit()
    {
        await SeedAsync(
            Evt("svc", "dev", "v3", DeploymentStatus.Success, new DateTime(2026, 5, 14, 10, 0, 0), 3),
            Evt("svc", "dev", "v2", DeploymentStatus.Success, new DateTime(2026, 5, 13, 10, 0, 0), 2),
            Evt("svc", "dev", "v1", DeploymentStatus.Success, new DateTime(2026, 5, 12, 10, 0, 0), 1));

        var resp = await _client.GetAsync("/api/deployments/svc/dev/history?limit=2");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var rows = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(rows);
        Assert.Equal(2, rows!.Length);
        Assert.Equal("v3", rows[0].Version);
        Assert.Equal("v2", rows[1].Version);
    }

    [Fact]
    public async Task Get_Environments_ReturnsDistinctSortedList()
    {
        await SeedAsync(
            Evt("a", "prod", "1", DeploymentStatus.Success, DateTime.UtcNow, 1),
            Evt("a", "dev",  "1", DeploymentStatus.Success, DateTime.UtcNow.AddSeconds(1), 2),
            Evt("b", "dev",  "1", DeploymentStatus.Success, DateTime.UtcNow.AddSeconds(2), 3));

        var resp = await _client.GetAsync("/api/environments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var envs = await resp.Content.ReadFromJsonAsync<string[]>();
        Assert.NotNull(envs);
        Assert.Equal(new[] { "dev", "prod" }, envs);
    }

    [Fact]
    public async Task Get_Services_ReturnsDistinctSortedList()
    {
        await SeedAsync(
            Evt("auth-service", "dev", "1", DeploymentStatus.Success, DateTime.UtcNow, 1),
            Evt("web-portal",   "dev", "1", DeploymentStatus.Success, DateTime.UtcNow.AddSeconds(1), 2));

        var resp = await _client.GetAsync("/api/services");
        var services = await resp.Content.ReadFromJsonAsync<string[]>();
        Assert.NotNull(services);
        Assert.Equal(new[] { "auth-service", "web-portal" }, services);
    }

    [Fact]
    public async Task Get_History_CarriesRefAndSha_PerEntry()
    {
        // SAD line 892: history endpoint returns full row fields including
        // ref and sha. Always-emit convention: present, null when stored
        // value is null.
        await SeedAsync(
            Evt("svc", "dev", "v2", DeploymentStatus.Success, new DateTime(2026, 5, 14, 10, 0, 0), 2,
                @ref: "feature/x", sha: "abc1234"),
            Evt("svc", "dev", "v1", DeploymentStatus.Success, new DateTime(2026, 5, 13, 10, 0, 0), 1));

        var resp = await _client.GetAsync("/api/deployments/svc/dev/history");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var rows = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = rows.EnumerateArray().ToList();
        Assert.Equal(2, items.Count);

        // Newest first — v2 carries the populated ref/sha.
        Assert.Equal("feature/x", items[0].GetProperty("ref").GetString());
        Assert.Equal("abc1234", items[0].GetProperty("sha").GetString());

        // v1 had neither set — both keys are present as JSON null.
        Assert.True(items[1].TryGetProperty("ref", out var refProp));
        Assert.True(items[1].TryGetProperty("sha", out var shaProp));
        Assert.Equal(JsonValueKind.Null, refProp.ValueKind);
        Assert.Equal(JsonValueKind.Null, shaProp.ValueKind);
    }

    [Fact]
    public async Task Get_Health_Returns_Ok()
    {
        var resp = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }
}
