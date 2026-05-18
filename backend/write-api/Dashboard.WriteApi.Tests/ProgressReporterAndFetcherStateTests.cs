using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Security;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.WriteApi.Tests;

/// <summary>
/// CR-0009 + ADR-0004 coverage — minimum happy-path + 422/404 spec for the
/// universal <c>X-Progress-Reporter</c> header on <c>POST /api/deployments</c>
/// and the new <c>GET</c>/<c>PUT /api/fetcher/state/{source-id}</c> surface.
///
/// <para>QA-engineer owns the broad regression in Wave 3 (1.5.10); these
/// tests are co-located with the implementation so the build is green before
/// hand-off (per dispatch contract).</para>
/// </summary>
public sealed class ProgressReporterAndFetcherStateTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public ProgressReporterAndFetcherStateTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static int _idSeed;

    private static DeploymentEventRequest ValidPayload(string? deploymentId = null) => new()
    {
        DeploymentId = deploymentId ?? $"gh-cr0009-{Interlocked.Increment(ref _idSeed)}",
        Service = "web-portal",
        Environment = "dev",
        Version = "v2.3.1",
        Status = "success",
        RunUrl = "https://github.com/org/repo/actions/runs/1247",
        RunNumber = 1247,
        Actor = "john.doe",
    };

    private HttpRequestMessage WithApiKey(HttpRequestMessage req)
    {
        req.Headers.Add(ApiKeyMiddleware.HeaderName, _factory.ApiKey);
        return req;
    }

    // ──────────────────────────────────────────────────────────────────────
    // POST /api/deployments — X-Progress-Reporter optional header
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_Deployments_WithValidProgressReporter_Returns201_PersistsValue_AndEchoes()
    {
        var deploymentId = $"gh-pr-valid-{Interlocked.Increment(ref _idSeed)}";
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(deploymentId), options: DashboardJson.Options),
        };
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, "dashboard-fetcher/github-actions");

        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        // (i) Response body echoes the header value verbatim under
        //     progress_reporter (CR-0009 Read API rule (iii)).
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>(DashboardJson.Options);
        Assert.True(body.TryGetProperty("progress_reporter", out var prProp),
            "response missing 'progress_reporter'");
        Assert.Equal("dashboard-fetcher/github-actions", prProp.GetString());

        // (ii) Round-trip through the DB so persistence is proven, not just echo.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var stored = db.Deployments.Single(d => d.DeploymentId == deploymentId);
        Assert.Equal("dashboard-fetcher/github-actions", stored.ProgressReporter);
    }

    [Fact]
    public async Task Post_Deployments_WithoutProgressReporter_Returns201_AndStoresNull()
    {
        var deploymentId = $"gh-pr-absent-{Interlocked.Increment(ref _idSeed)}";
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(deploymentId), options: DashboardJson.Options),
        };
        // intentionally NO X-Progress-Reporter header
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>(DashboardJson.Options);
        Assert.True(body.TryGetProperty("progress_reporter", out var prProp),
            "response missing 'progress_reporter' key (key must be always-present, null when absent)");
        Assert.Equal(JsonValueKind.Null, prProp.ValueKind);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var stored = db.Deployments.Single(d => d.DeploymentId == deploymentId);
        Assert.Null(stored.ProgressReporter);
    }

    [Fact]
    public async Task Post_Deployments_WithProgressReporterOver64Chars_Returns422_WithProblemDetails()
    {
        var deploymentId = $"gh-pr-cap-{Interlocked.Increment(ref _idSeed)}";
        var oversized = new string('z', 65); // one past the cap

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(deploymentId), options: DashboardJson.Options),
        };
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, oversized);

        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(422, body.GetProperty("status").GetInt32());
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty(WriteApiEndpoints.ProgressReporterHeaderName, out var prErrors),
            $"expected '{WriteApiEndpoints.ProgressReporterHeaderName}' error key, got: " +
            $"{string.Join(",", errors.EnumerateObject().Select(p => p.Name))}");
        Assert.True(prErrors.GetArrayLength() >= 1);

        // And the row was not persisted.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        Assert.False(db.Deployments.Any(d => d.DeploymentId == deploymentId));
    }

    // ──────────────────────────────────────────────────────────────────────
    // GET / PUT /api/fetcher/state/{source-id}
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_FetcherState_WhenRowExists_Returns200_WithCanonicalShape()
    {
        // Seed a row via PUT first so the GET has something to read.
        const string progressReporter = "dashboard-fetcher/github-actions";
        var sourceId = $"acme/svc-{Interlocked.Increment(ref _idSeed)}";

        await PutFetcherState(progressReporter, sourceId, "deployment-id-12345");

        var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/fetcher/state/{sourceId}");
        getReq.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(getReq));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<FetcherStateResponse>(DashboardJson.Options);
        Assert.NotNull(body);
        Assert.Equal(progressReporter, body!.ProgressReporter);
        Assert.Equal(sourceId, body.SourceId);
        Assert.Equal("deployment-id-12345", body.Cursor);
        Assert.True(body.UpdatedAt > DateTime.UtcNow.AddMinutes(-1),
            "updated_at should be recent (server-stamped on the PUT a moment ago)");
    }

    [Fact]
    public async Task Get_FetcherState_WhenRowMissing_Returns404_WithProblemDetails()
    {
        var sourceId = $"never-seen-{Interlocked.Increment(ref _idSeed)}";
        var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/fetcher/state/{sourceId}");
        getReq.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, "dashboard-fetcher/never");
        var resp = await _client.SendAsync(WithApiKey(getReq));

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(404, body.GetProperty("status").GetInt32());
        Assert.Equal("fetcher_state_not_found", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task Get_FetcherState_MissingProgressReporterHeader_Returns422()
    {
        // Header is required on the fetcher-state endpoints (CR-0009 § 3b).
        var sourceId = $"acme/svc-{Interlocked.Increment(ref _idSeed)}";
        var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/fetcher/state/{sourceId}");
        // intentionally NO X-Progress-Reporter header
        var resp = await _client.SendAsync(WithApiKey(getReq));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty(WriteApiEndpoints.ProgressReporterHeaderName, out _));
    }

    [Fact]
    public async Task Put_FetcherState_UpsertHappyPath_Returns200_EchoesRow()
    {
        const string progressReporter = "dashboard-fetcher/github-actions";
        var sourceId = $"acme/upsert-{Interlocked.Increment(ref _idSeed)}";

        var body = await PutFetcherState(progressReporter, sourceId, "cursor-1");

        Assert.Equal(progressReporter, body.ProgressReporter);
        Assert.Equal(sourceId, body.SourceId);
        Assert.Equal("cursor-1", body.Cursor);
        Assert.True(body.UpdatedAt > DateTime.UtcNow.AddMinutes(-1));
    }

    [Fact]
    public async Task Put_FetcherState_RepeatUpsert_OverwritesCursor_AndAdvancesUpdatedAt()
    {
        const string progressReporter = "dashboard-fetcher/github-actions";
        var sourceId = $"acme/repeat-{Interlocked.Increment(ref _idSeed)}";

        var first = await PutFetcherState(progressReporter, sourceId, "cursor-1");

        // Force a measurable delta between the two server-stamped timestamps.
        await Task.Delay(50);

        var second = await PutFetcherState(progressReporter, sourceId, "cursor-2");

        Assert.Equal("cursor-2", second.Cursor);
        Assert.True(second.UpdatedAt >= first.UpdatedAt,
            $"second updated_at ({second.UpdatedAt:O}) must not be before first ({first.UpdatedAt:O})");

        // And it really was an UPDATE, not a duplicate row (the composite key
        // would have thrown).
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var count = db.FetcherStates.Count(s => s.ProgressReporter == progressReporter && s.SourceId == sourceId);
        Assert.Equal(1, count);
    }

    [Fact]
    public async Task Put_FetcherState_CursorOver4096_Returns422_WithProblemDetails()
    {
        const string progressReporter = "dashboard-fetcher/github-actions";
        var sourceId = $"acme/oversized-{Interlocked.Increment(ref _idSeed)}";
        var oversized = new string('c', 4097);

        var raw = $$"""{ "cursor": "{{oversized}}" }""";
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/fetcher/state/{sourceId}")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(422, body.GetProperty("status").GetInt32());
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("cursor", out _),
            $"expected camelCase 'cursor' error key, got: " +
            $"{string.Join(",", errors.EnumerateObject().Select(p => p.Name))}");

        // Nothing was persisted.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        Assert.False(db.FetcherStates.Any(s => s.SourceId == sourceId));
    }

    private async Task<FetcherStateResponse> PutFetcherState(
        string progressReporter, string sourceId, string cursor)
    {
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/fetcher/state/{sourceId}")
        {
            Content = JsonContent.Create(new FetcherStateRequest { Cursor = cursor },
                                          options: DashboardJson.Options),
        };
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(req));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<FetcherStateResponse>(DashboardJson.Options);
        Assert.NotNull(body);
        return body!;
    }
}
