using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for infrastructure endpoints:
/// <c>GET /healthz</c>, <c>GET /openapi/v1.json</c>, <c>GET /scalar/v1</c>.
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class InfrastructureEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public InfrastructureEndpointTests(PostgresFixture fixture) => _fixture = fixture;

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

    // ── GET /healthz ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetHealthz_Returns200()
    {
        var res = await _client.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GetHealthz_BodyContainsStatusOk()
    {
        var res = await _client.GetAsync("/healthz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }

    // ── GET /readyz ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetReadyz_DbReachable_Returns200()
    {
        // Allow the broadcaster to establish the LISTEN connection.
        await Task.Delay(1000);

        var res = await _client.GetAsync("/readyz");

        // DB is reachable via Testcontainers → always 200 (ready or degraded).
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task GetReadyz_Returns200WithStatusAndChecks()
    {
        await Task.Delay(1000);

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        var status = body.GetProperty("status").GetString();
        Assert.True(status is "ready" or "degraded",
            $"status must be 'ready' or 'degraded', got '{status}'");

        var checks = body.GetProperty("checks");
        Assert.Equal("ok", checks.GetProperty("db").GetString());
    }

    [Fact]
    public async Task GetReadyz_WhenListenerConnected_StatusIsReady()
    {
        // Give all three broadcasters enough time to establish LISTEN on the Testcontainers Postgres.
        await Task.Delay(3000);

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("ready", body.GetProperty("status").GetString());
    }

    [Fact]
    public async Task GetReadyz_IncludesListenAcksCheck()
    {
        await Task.Delay(3000);

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.True(checks.TryGetProperty("listen_acks", out _),
            "readyz checks must include 'listen_acks' for the component_acks channel (D10).");
    }

    [Fact]
    public async Task GetReadyz_IncludesListenComponentEventsCheck()
    {
        // Give the ComponentEventBroadcaster time to establish LISTEN component_events.
        await Task.Delay(3000);

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.True(checks.TryGetProperty("listen_component_events", out _),
            "readyz checks must include 'listen_component_events' for the component_events channel (§11 ch.4).");
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
