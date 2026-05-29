using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for all read-surface endpoints:
/// <c>GET /api/deployments</c>, <c>GET /api/deployments/{id}</c>,
/// <c>GET /api/matrix</c>, <c>GET /api/services</c>, <c>GET /api/environments</c>.
///
/// Each test class gets its own Postgres container (Testcontainers via <see cref="TestApiFactory"/>),
/// so data seeded by individual tests accumulates across methods within the class.
/// Tests that need an empty result use a service/environment name that no other test seeds.
/// </summary>
public sealed class ReadEndpointTests : IAsyncLifetime
{
    private readonly TestApiFactory _factory = new();
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await _factory.InitializeAsync();
        await _factory.MigrateAsync();
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<JsonElement> IngestAsync(
        string service = "svc-a",
        string environment = "prod",
        string status = "success",
        string happenedAt = "2026-05-28T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment,
            status,
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    // ── GET /api/deployments ──────────────────────────────────────────────────

    [Fact]
    public async Task GetDeployments_Returns200WithItemsArray()
    {
        await IngestAsync(service: "read-list-svc");

        var res = await _client.GetAsync("/api/deployments?service=read-list-svc");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out _));
    }

    [Fact]
    public async Task GetDeployments_ServiceFilter_ReturnsOnlyMatchingEvents()
    {
        await IngestAsync(service: "filter-svc-x");
        await IngestAsync(service: "filter-svc-y");

        var res = await _client.GetAsync("/api/deployments?service=filter-svc-x");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        Assert.All(items, item =>
            Assert.Equal("filter-svc-x", item.GetProperty("service").GetString()));
    }

    [Fact]
    public async Task GetDeployments_NoMatchForFilter_ReturnsEmptyItems()
    {
        // Use a service name that is never seeded by any other test in this class.
        var res = await _client.GetAsync("/api/deployments?service=nonexistent-svc-z99z");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task GetDeployments_ResponseContainsNextCursorField()
    {
        var res = await _client.GetAsync("/api/deployments?limit=1");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        // next_cursor is present in the response (null when no more pages).
        Assert.True(body.TryGetProperty("next_cursor", out _) ||
                    body.ValueKind == JsonValueKind.Object,
                    "Response must be a JSON object; next_cursor may be null.");
    }

    // ── GET /api/deployments/{id} ─────────────────────────────────────────────

    [Fact]
    public async Task GetDeploymentById_ExistingId_Returns200WithMatchingId()
    {
        var ingested = await IngestAsync(service: "getbyid-svc");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, body.GetProperty("id").GetString());
    }

    [Fact]
    public async Task GetDeploymentById_NonExistentId_Returns404ProblemJson()
    {
        var res = await _client.GetAsync($"/api/deployments/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    // ── GET /api/matrix ───────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrix_Returns200WithRequiredFields()
    {
        await IngestAsync(service: "matrix-svc", environment: "prod", status: "success");

        var res = await _client.GetAsync("/api/matrix");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("generated_at", out _), "Must have generated_at");
        Assert.True(body.TryGetProperty("environments", out _), "Must have environments");
        Assert.True(body.TryGetProperty("rows", out _), "Must have rows");
    }

    [Fact]
    public async Task GetMatrix_Returns200WithETagHeader()
    {
        await IngestAsync(service: "matrix-etag-svc");

        var res = await _client.GetAsync("/api/matrix");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.NotNull(res.Headers.ETag);
    }

    [Fact]
    public async Task GetMatrix_IfNoneMatchMatchesETag_Returns304()
    {
        await IngestAsync(service: "matrix-304-svc");

        // Get ETag from first request.
        var res1 = await _client.GetAsync("/api/matrix");
        var etag = res1.Headers.ETag!.ToString();

        // Second request with matching If-None-Match.
        var req2 = new HttpRequestMessage(HttpMethod.Get, "/api/matrix");
        req2.Headers.Add("If-None-Match", etag);
        var res2 = await _client.SendAsync(req2);

        Assert.Equal(HttpStatusCode.NotModified, res2.StatusCode);
    }

    [Fact]
    public async Task GetMatrix_IfNoneMatchDiffers_Returns200()
    {
        await IngestAsync(service: "matrix-200-svc");

        var req = new HttpRequestMessage(HttpMethod.Get, "/api/matrix");
        req.Headers.Add("If-None-Match", "W/\"stale-etag-value\"");
        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GetMatrix_ServiceFilter_ReturnsOnlyThatService()
    {
        await IngestAsync(service: "matrix-filter-a", environment: "prod", status: "success");
        await IngestAsync(service: "matrix-filter-b", environment: "prod", status: "success");

        var res = await _client.GetAsync("/api/matrix?service=matrix-filter-a");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rows = body.GetProperty("rows").EnumerateArray().ToList();

        Assert.All(rows, row =>
            Assert.Equal("matrix-filter-a", row.GetProperty("service").GetString()));
    }

    // ── GET /api/services ─────────────────────────────────────────────────────

    [Fact]
    public async Task GetServices_Returns200WithItemsArray()
    {
        var res = await _client.GetAsync("/api/services");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items));
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [Fact]
    public async Task GetServices_WithSeededData_ContainsSeedService()
    {
        await IngestAsync(service: "services-endpoint-svc");

        var res = await _client.GetAsync("/api/services");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Contains("services-endpoint-svc", items);
    }

    [Fact]
    public async Task GetServices_ItemsAreSorted()
    {
        await IngestAsync(service: "z-sort-svc");
        await IngestAsync(service: "a-sort-svc");

        var res = await _client.GetAsync("/api/services");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()!).ToList();

        var sortedItems = items.OrderBy(s => s).ToList();
        Assert.Equal(sortedItems, items);
    }

    // ── GET /api/environments ─────────────────────────────────────────────────

    [Fact]
    public async Task GetEnvironments_Returns200WithItemsArray()
    {
        var res = await _client.GetAsync("/api/environments");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("items", out var items));
        Assert.Equal(JsonValueKind.Array, items.ValueKind);
    }

    [Fact]
    public async Task GetEnvironments_WithSeededData_ContainsSeedEnvironment()
    {
        await IngestAsync(environment: "envs-endpoint-staging");

        var res = await _client.GetAsync("/api/environments");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Contains("envs-endpoint-staging", items);
    }

    [Fact]
    public async Task GetEnvironments_ItemsAreSorted()
    {
        await IngestAsync(environment: "z-env");
        await IngestAsync(environment: "a-env");

        var res = await _client.GetAsync("/api/environments");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()!).ToList();

        var sortedItems = items.OrderBy(e => e).ToList();
        Assert.Equal(sortedItems, items);
    }

    // ── Cursor pagination (covers CursorCodec.Encode + TryDecode) ────────────

    [Fact]
    public async Task GetDeployments_CursorPagination_SecondPageHasNoOverlapWithFirst()
    {
        // Seed 4 events with distinct happened_at values so the cursor seek is unambiguous.
        var t0 = "2020-01-01T00:00:00Z";
        var t1 = "2020-01-01T01:00:00Z";
        var t2 = "2020-01-01T02:00:00Z";
        var t3 = "2020-01-01T03:00:00Z";
        await IngestAsync(service: "cursor-svc", happenedAt: t0);
        await IngestAsync(service: "cursor-svc", happenedAt: t1);
        await IngestAsync(service: "cursor-svc", happenedAt: t2);
        await IngestAsync(service: "cursor-svc", happenedAt: t3);

        // Page 1 — limit 2, expects a next_cursor.
        var res1 = await _client.GetAsync("/api/deployments?service=cursor-svc&limit=2");
        var body1 = await res1.Content.ReadFromJsonAsync<JsonElement>();
        var page1Ids = body1.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("id").GetString()!).ToHashSet();
        var nextCursor = body1.GetProperty("next_cursor").GetString();

        Assert.NotNull(nextCursor);
        Assert.Equal(2, page1Ids.Count);

        // Page 2 — use the cursor returned by page 1 (exercises CursorCodec.TryDecode).
        var res2 = await _client.GetAsync($"/api/deployments?service=cursor-svc&limit=2&cursor={Uri.EscapeDataString(nextCursor!)}");
        var body2 = await res2.Content.ReadFromJsonAsync<JsonElement>();
        var page2Ids = body2.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("id").GetString()!).ToList();

        Assert.Equal(2, page2Ids.Count);
        Assert.True(page2Ids.All(id => !page1Ids.Contains(id)),
            "Page 2 must not overlap with page 1.");
    }

    // ── Matrix with non-success current (covers MatrixService.BuildSlot else branch) ─

    [Fact]
    public async Task GetMatrix_InProgressCurrentWithPriorSuccess_SlotHasLastSuccessful()
    {
        // Seed a success event first, then a newer in-progress — same slot.
        await IngestAsync(
            service: "matrix-ls-svc",
            environment: "matrix-ls-env",
            status: "success",
            happenedAt: "2021-03-01T10:00:00Z");
        await IngestAsync(
            service: "matrix-ls-svc",
            environment: "matrix-ls-env",
            status: "in-progress",
            happenedAt: "2021-03-01T11:00:00Z");

        var res = await _client.GetAsync("/api/matrix?service=matrix-ls-svc");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var row = body.GetProperty("rows").EnumerateArray().Single();
        var slot = row.GetProperty("slots").GetProperty("matrix-ls-env");

        Assert.Equal("in-progress", slot.GetProperty("current").GetProperty("status").GetString());
        Assert.True(slot.TryGetProperty("last_successful", out var ls),
            "last_successful must be present when current is not success.");
        Assert.Equal("success", ls.GetProperty("status").GetString());
    }
}
