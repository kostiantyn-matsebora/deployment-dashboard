using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for infrastructure endpoints:
/// <c>GET /healthz</c>, <c>GET /openapi/v1.json</c>, <c>GET /scalar/v1</c>.
/// </summary>
public sealed class InfrastructureEndpointTests : IAsyncLifetime
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

    // ── GET /healthz ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHealthz_Returns200()
    {
        var res = await _client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // ── GET /openapi/v1.json ──────────────────────────────────────────────────

    [Fact]
    public async Task GetOpenApiDocument_Returns200()
    {
        var res = await _client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GetOpenApiDocument_ContentTypeIsJson()
    {
        var res = await _client.GetAsync("/openapi/v1.json");
        Assert.Equal("application/json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task GetOpenApiDocument_BodyContainsOpenApiVersion()
    {
        var res = await _client.GetAsync("/openapi/v1.json");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("openapi", out var version), "Document must have 'openapi' field.");
        Assert.StartsWith("3.", version.GetString());
    }

    [Fact]
    public async Task GetOpenApiDocument_BodyContainsApiEndpoints()
    {
        var res = await _client.GetAsync("/openapi/v1.json");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("paths", out var paths), "Document must have 'paths'.");
        Assert.True(paths.EnumerateObject().Any(), "Document must declare at least one path.");
    }

    // ── GET /scalar/v1 ────────────────────────────────────────────────────────

    [Fact]
    public async Task GetScalarUi_Returns200()
    {
        var res = await _client.GetAsync("/scalar/v1");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GetScalarUi_ContentTypeIsHtml()
    {
        var res = await _client.GetAsync("/scalar/v1");
        Assert.Equal("text/html", res.Content.Headers.ContentType?.MediaType);
    }
}
