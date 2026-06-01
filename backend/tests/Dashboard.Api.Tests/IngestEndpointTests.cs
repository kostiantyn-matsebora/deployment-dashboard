using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>POST /api/deployments</c>.
/// Runs against a real Postgres container (shared via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class IngestEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public IngestEndpointTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString);
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static object MinimalPayload(string status = "success") => new
    {
        deployment_id = "gh-001",
        service = "checkout-api",
        environment = "prod",
        status,
        happened_at = "2026-05-28T10:14:02Z",
    };

    private HttpRequestMessage BuildPost(object body, string? apiKey = TestApiFactory.TestApiKey)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(body),
        };
        if (apiKey is not null)
            msg.Headers.Add("X-Api-Key", apiKey);
        return msg;
    }

    // ── Auth ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_NoApiKey_Returns401()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload(), apiKey: null));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Post_WrongApiKey_Returns401()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload(), apiKey: "wrong"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── Happy path ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_ValidMinimalPayload_Returns201WithLocation()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload()));

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.NotNull(res.Headers.Location);
        Assert.StartsWith("/api/deployments/", res.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Post_ValidPayload_ResponseBodyContainsId()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload()));
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(body.TryGetProperty("id", out var idProp));
        Assert.True(Guid.TryParse(idProp.GetString(), out _));
    }

    [Fact]
    public async Task Post_ValidPayload_LocationMatchesBodyId()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload()));
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var id = body.GetProperty("id").GetString();
        Assert.Equal($"/api/deployments/{id}", res.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Post_WithProgressReporter_StoredOnRow()
    {
        var msg = BuildPost(MinimalPayload());
        msg.Headers.Add("X-Progress-Reporter", "dashboard-fetcher/github-actions");

        var res = await _client.SendAsync(msg);

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("dashboard-fetcher/github-actions",
            body.GetProperty("progress_reporter").GetString());
    }

    // ── Validation — 422 ────────────────────────────────────────────────────

    [Fact]
    public async Task Post_MissingRequiredField_Returns422WithErrors()
    {
        // deployment_id is missing
        var payload = new { service = "svc", environment = "dev", status = "success", happened_at = "2026-01-01T00:00:00Z" };
        var res = await _client.SendAsync(BuildPost(payload));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("errors", out _));
    }

    [Fact]
    public async Task Post_InvalidStatus_Returns422()
    {
        var res = await _client.SendAsync(BuildPost(MinimalPayload("pending")));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.GetProperty("errors").GetArrayLength() > 0);
    }

    [Fact]
    public async Task Post_UnknownField_Returns422()
    {
        var payload = new
        {
            deployment_id = "gh-001",
            service = "svc",
            environment = "dev",
            status = "success",
            happened_at = "2026-01-01T00:00:00Z",
            unknown_extra_field = "boom",
        };
        var res = await _client.SendAsync(BuildPost(payload));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    [Fact]
    public async Task Post_TooManyParentDeployments_Returns422()
    {
        var payload = new
        {
            deployment_id = "gh-001",
            service = "svc",
            environment = "dev",
            status = "success",
            happened_at = "2026-01-01T00:00:00Z",
            parent_deployments = Enumerable.Range(1, 33).Select(i => $"gh-{i:D3}").ToArray(),
        };
        var res = await _client.SendAsync(BuildPost(payload));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }
}
