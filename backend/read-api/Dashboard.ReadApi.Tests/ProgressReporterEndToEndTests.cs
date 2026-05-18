using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// CR-0009 — end-to-end Read coverage for <c>progress_reporter</c> across
/// every per-event surface the SAD lists (history / matrix / single-slot /
/// SSE). BE's <see cref="ProgressReporterReadShapeTests"/> already covers the
/// happy-path matrix shape; this suite expands to:
///
/// <list type="bullet">
///   <item>Single-slot endpoint surfaces <c>progress_reporter</c> on
///   <c>current</c> + <c>lastSuccessful</c>.</item>
///   <item>Matrix payload exposes the field as an always-present key (null
///   when the column is null).</item>
///   <item>topology.edges intentionally has NO <c>progress_reporter</c>
///   (per-service derived structure carries no per-event attributes).</item>
/// </list>
/// </summary>
public sealed class ProgressReporterEndToEndTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public ProgressReporterEndToEndTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.RemoveRange(db.Deployments);
        db.SaveChanges();
    }

    private static int _nextId;

    private static DeploymentEntity Evt(string s, string e, string v, string status, DateTime at, string? progressReporter)
        => new()
        {
            DeploymentId = $"pr-e2e-{Interlocked.Increment(ref _nextId)}",
            Service = s,
            Environment = e,
            Version = v,
            Status = status,
            RunUrl = "https://example.com/r/1",
            RunNumber = 1,
            Actor = "tester",
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            ProgressReporter = progressReporter,
        };

    [Fact]
    public async Task Get_SingleSlot_CarriesProgressReporter_OnCurrentAndLastSuccessful()
    {
        // Set up: lastSuccessful != current (need an earlier success with a
        // different version; current is in-progress so it isn't the latest
        // success itself).
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.AddRange(
                Evt("svc", "dev", "v3", DeploymentStatus.InProgress,
                    new DateTime(2026, 5, 16, 10, 0, 0), "dashboard-fetcher/github-actions"),
                Evt("svc", "dev", "v2", DeploymentStatus.Success,
                    new DateTime(2026, 5, 15, 10, 0, 0), "ci-pipeline/gha-composite"));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments/svc/dev");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var slot = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("dashboard-fetcher/github-actions",
            slot.GetProperty("current").GetProperty("progress_reporter").GetString());
        Assert.Equal("ci-pipeline/gha-composite",
            slot.GetProperty("lastSuccessful").GetProperty("progress_reporter").GetString());
    }

    [Fact]
    public async Task Get_Matrix_ProgressReporterKey_AlwaysPresent_NullWhenColumnNull()
    {
        // Always-emit convention check: when the column is null, the JSON
        // key must still be present with `null` value (matches CR-0004 ref/sha
        // convention so SPA pattern-matching is uniform).
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.AddRange(
                Evt("svc", "dev", "v2", DeploymentStatus.InProgress,
                    new DateTime(2026, 5, 16, 10, 0, 0), progressReporter: null),
                Evt("svc", "dev", "v1", DeploymentStatus.Success,
                    new DateTime(2026, 5, 15, 10, 0, 0), progressReporter: null));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var root = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var slot = root.GetProperty("svc").GetProperty("envs").GetProperty("dev");

        // Key present on current
        Assert.True(slot.GetProperty("current").TryGetProperty("progress_reporter", out var cpr));
        Assert.Equal(JsonValueKind.Null, cpr.ValueKind);

        // Key present on lastSuccessful
        Assert.True(slot.GetProperty("lastSuccessful").TryGetProperty("progress_reporter", out var lpr));
        Assert.Equal(JsonValueKind.Null, lpr.ValueKind);
    }

    [Fact]
    public async Task Get_Matrix_TopologyEdges_DoNotCarryProgressReporter()
    {
        // CR-0009 (iii) recommendation: progress_reporter is NOT added to
        // topology.edges (per-service derived structure carries no per-event
        // attributes — CR-0003 / ADR-0001). Lock the absence so a future
        // accidental projection-leak fails this test loudly.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            var parent = Evt("svc", "dev", "v1", DeploymentStatus.Success,
                new DateTime(2026, 5, 14, 10, 0, 0), "dashboard-fetcher/github-actions");
            parent.DeploymentId = "p-topology";

            var child = Evt("svc", "qa", "v1", DeploymentStatus.Success,
                new DateTime(2026, 5, 14, 11, 0, 0), "ci-pipeline/gha-composite");
            child.DeploymentId = "q-topology";
            child.ParentDeployments = new List<string> { "p-topology" };

            db.Deployments.AddRange(parent, child);
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var root = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var edges = root.GetProperty("svc").GetProperty("topology").GetProperty("edges");
        Assert.True(edges.GetArrayLength() >= 1);

        foreach (var edge in edges.EnumerateArray())
        {
            Assert.False(edge.TryGetProperty("progress_reporter", out _),
                "topology.edges entry MUST NOT carry progress_reporter (per-service derived structure).");
        }
    }
}
