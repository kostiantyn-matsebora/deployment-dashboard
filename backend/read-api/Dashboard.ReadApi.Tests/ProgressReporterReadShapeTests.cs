using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// CR-0009 Read API rule (iii): <c>progress_reporter</c> appears on every
/// per-event surface that already exposes per-event attributes — history
/// endpoint + matrix <c>current</c> / <c>lastSuccessful</c> + SSE
/// <c>slot-update.state</c>. <strong>Not</strong> on <c>topology.edges</c>.
///
/// <para>This file co-locates the Read-side happy-path check; QA-engineer
/// owns broader regression in Wave 3 (WBS 1.5.10).</para>
/// </summary>
public sealed class ProgressReporterReadShapeTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public ProgressReporterReadShapeTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();

        // Wipe table so prior tests don't pollute discovery / matrix shape.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        db.Deployments.RemoveRange(db.Deployments);
        db.SaveChanges();
    }

    private static int _nextId;

    private static DeploymentEntity Evt(string s, string e, string v, string status, DateTime at, string? progressReporter)
        => new()
        {
            DeploymentId = $"pr-shape-{Interlocked.Increment(ref _nextId)}",
            Service = s, Environment = e, Version = v, Status = status,
            RunUrl = "https://example.com/r/1",
            RunNumber = 1,
            Actor = "tester",
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            ProgressReporter = progressReporter,
        };

    [Fact]
    public async Task Get_History_CarriesProgressReporter_PerEntry()
    {
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            db.Deployments.AddRange(
                Evt("svc", "dev", "v2", DeploymentStatus.Success,
                    new DateTime(2026, 5, 16, 10, 0, 0), "dashboard-fetcher/github-actions"),
                Evt("svc", "dev", "v1", DeploymentStatus.Success,
                    new DateTime(2026, 5, 15, 10, 0, 0), progressReporter: null));
            await db.SaveChangesAsync();
        }

        var resp = await _client.GetAsync("/api/deployments/svc/dev/history");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var rows = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var items = rows.EnumerateArray().ToList();
        Assert.Equal(2, items.Count);

        // Newest first — v2 carries the populated header.
        Assert.True(items[0].TryGetProperty("progress_reporter", out var p0));
        Assert.Equal("dashboard-fetcher/github-actions", p0.GetString());

        // v1 had null on ingest — key present, value null (always-emit convention).
        Assert.True(items[1].TryGetProperty("progress_reporter", out var p1));
        Assert.Equal(JsonValueKind.Null, p1.ValueKind);
    }

    [Fact]
    public async Task Get_Matrix_CarriesProgressReporter_OnCurrentAndLastSuccessful()
    {
        // Matrix: current = newest, lastSuccessful = most recent successful
        // *not equal to* current (when current itself is a success and is the
        // most recent success, lastSuccessful is null per SAD §7 +
        // MatrixQuery). To populate both: current = in-progress with one
        // value, lastSuccessful = an earlier success with a different value.
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

        var resp = await _client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var root = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var slot = root.GetProperty("svc").GetProperty("envs").GetProperty("dev");

        Assert.Equal("dashboard-fetcher/github-actions",
            slot.GetProperty("current").GetProperty("progress_reporter").GetString());
        Assert.Equal("ci-pipeline/gha-composite",
            slot.GetProperty("lastSuccessful").GetProperty("progress_reporter").GetString());

        // topology.edges intentionally has NO progress_reporter (per-service
        // structure carries no per-event attributes — CR-0003 / CR-0009 (iii)).
        // No assertion needed beyond not breaking the topology shape.
    }
}
