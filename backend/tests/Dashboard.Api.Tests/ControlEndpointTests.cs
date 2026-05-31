using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>POST /api/control/reset</c>.
/// Verifies authentication, the 204 happy path, and that both tables are cleared.
/// Runs against a real Postgres container (Testcontainers).
/// </summary>
public sealed class ControlEndpointTests : IAsyncLifetime
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

    private HttpRequestMessage ResetRequest(string? controlKey = TestApiFactory.TestControlApiKey) =>
        BuildRequest(HttpMethod.Post, "/api/control/reset", controlKey);

    private HttpRequestMessage BuildRequest(HttpMethod method, string path, string? controlKey)
    {
        var req = new HttpRequestMessage(method, path);
        if (controlKey is not null)
            req.Headers.Add("X-Control-API-Key", controlKey);
        return req;
    }

    private async Task IngestAsync(string service = "ctrl-svc", string environment = "prod")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(new
            {
                deployment_id = $"gh-{Guid.NewGuid():N}",
                service,
                environment,
                status = "success",
                happened_at = "2026-05-28T10:00:00Z",
            }),
        };
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    private async Task PutFetcherStateAsync(string adapter = "ctrl-adapter")
    {
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/fetcher/state/{adapter}")
        {
            Content = JsonContent.Create(new { cursor = "opaque-cursor" }),
        };
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    private async Task PostComponentEventAsync(string componentId = "ctrl-component")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "status",
                state = "running",
                occurred_at = "2026-05-28T10:00:00Z",
            }),
        };
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        req.Headers.Add("X-Component-Id", componentId);
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    // ── Authentication ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_NoControlApiKey_Returns401ProblemJson()
    {
        var res = await _client.SendAsync(ResetRequest(controlKey: null));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Post_WrongControlApiKey_Returns401()
    {
        var res = await _client.SendAsync(ResetRequest(controlKey: "wrong-key"));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Post_ApiKeyInsteadOfControlKey_Returns401()
    {
        // X-Api-Key must NOT be accepted on the control surface (D8: least-privilege).
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestApiKey); // write key, wrong header name value
        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── Happy path ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_ValidControlApiKey_Returns204()
    {
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task Post_ValidControlApiKey_EmptyStore_Returns204()
    {
        // Idempotent: succeeds even when tables are already empty.
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    // ── Table clearing ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_AfterIngest_DeploymentEventsAreCleared()
    {
        await IngestAsync("reset-svc-de", "prod");

        // Confirm the event is present before reset.
        var before = await _client.GetAsync("/api/deployments?service=reset-svc-de");
        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(beforeBody.GetProperty("items").GetArrayLength() > 0);

        await _client.SendAsync(ResetRequest());

        var after = await _client.GetAsync("/api/deployments?service=reset-svc-de");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, afterBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Post_AfterComponentEvent_ComponentEventsAreCleared()
    {
        await PostComponentEventAsync("reset-component");

        var before = await _client.GetAsync("/api/control/events?component_id=reset-component");
        var beforeBody = await before.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(beforeBody.GetProperty("items").GetArrayLength() > 0);

        await _client.SendAsync(ResetRequest());

        var after = await _client.GetAsync("/api/control/events?component_id=reset-component");
        var afterBody = await after.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, afterBody.GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Post_AfterFetcherStateWrite_FetcherStateIsCleared()
    {
        await PutFetcherStateAsync("reset-adapter");

        // Confirm state is present before reset.
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/reset-adapter");
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var before = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, before.StatusCode);

        await _client.SendAsync(ResetRequest());

        var req2 = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/reset-adapter");
        req2.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var after = await _client.SendAsync(req2);
        Assert.Equal(HttpStatusCode.NotFound, after.StatusCode);
    }
}

/// <summary>
/// Tests the control surface when <c>CONTROL_API_KEY</c> is absent from configuration.
/// The endpoint must be completely hidden — returns <c>404</c> regardless of the header sent.
/// </summary>
public sealed class ControlEndpointUnconfiguredTests : IAsyncLifetime
{
    // Factory with IncludeControlKey = false simulates a deployment where the key was never set.
    private readonly TestApiFactory _factory = new() { IncludeControlKey = false };
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

    [Fact]
    public async Task Post_ControlKeyNotConfigured_Returns404()
    {
        // No key in config → endpoint is hidden regardless of what header is provided.
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        req.Headers.Add("X-Control-API-Key", "any-value");

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task Post_ControlKeyNotConfigured_NoHeader_Returns404()
    {
        var res = await _client.PostAsync("/api/control/reset", content: null);

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}
