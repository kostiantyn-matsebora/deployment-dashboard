using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>POST /api/control/reset</c> authentication.
/// Data-clearing and choreography behaviour are covered by <see cref="ResetChoreographyTests"/>.
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class ControlEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ControlEndpointTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString);
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        // Drain (issue #423 flake fix, 2nd pass): Post_ValidControlApiKey_Returns202 and
        // Post_ValidControlApiKey_BodyContainsCorrelationIdStateAndAcceptedAt each trigger a
        // real reset via POST /api/control/reset and never send an ack, so their orchestrator
        // is still driving toward its own AckTimeoutSeconds at teardown — leaking into the next
        // test in this collection if not drained here first. See Helpers.ResetCycleQuiescence
        // for the full root-cause writeup.
        await ResetCycleQuiescence.WaitForIdleAsync(_fixture.ConnectionString);

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
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── Happy path — 202 ──────────────────────────────────────────────────────

    [Fact]
    public async Task Post_ValidControlApiKey_Returns202()
    {
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
    }

    [Fact]
    public async Task Post_ValidControlApiKey_BodyContainsCorrelationIdStateAndAcceptedAt()
    {
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("draining", body.GetProperty("state").GetString());
        Assert.NotEqual(Guid.Empty, Guid.Parse(body.GetProperty("correlation_id").GetString()!));
        Assert.True(body.TryGetProperty("accepted_at", out _));
        // reset_id is retired; the field must NOT be present in the 202 body.
        Assert.False(body.TryGetProperty("reset_id", out _), "202 body must not contain 'reset_id' — retired in favour of 'correlation_id'.");
    }
}

/// <summary>
/// Tests the control surface when <c>CONTROL_API_KEY</c> is absent from configuration.
/// The endpoint must be completely hidden — returns <c>404</c> regardless of the header sent.
/// </summary>
[Collection("api-postgres")]
public sealed class ControlEndpointUnconfiguredTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    // Factory with IncludeControlKey = false simulates a deployment where the key was never set.
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ControlEndpointUnconfiguredTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString) { IncludeControlKey = false };
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
