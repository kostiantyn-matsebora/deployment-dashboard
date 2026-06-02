using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>POST /api/control/events</c>.
/// Verifies X-Api-Key auth, X-Component-Id validation (422), body validation (422),
/// the 8 KiB payload limit (413), and the 204 happy path.
/// The listing endpoint was replaced by an SSE stream — see <see cref="ComponentEventStreamTests"/>.
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class ComponentEventTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ComponentEventTests(PostgresFixture fixture) => _fixture = fixture;

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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static HttpRequestMessage PostRequest(
        string? apiKey = TestApiFactory.TestApiKey,
        string? componentId = "demo-driver",
        object? body = null)
    {
        body ??= new
        {
            event_type = "status",
            state = "running",
            detail = "polling",
            occurred_at = "2026-05-31T10:00:00Z",
        };

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(body),
        };
        if (apiKey is not null) req.Headers.Add("X-Api-Key", apiKey);
        if (componentId is not null) req.Headers.Add("X-Component-Id", componentId);
        return req;
    }

    // ── Auth (401) ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_NoApiKey_Returns401()
    {
        var res = await _client.SendAsync(PostRequest(apiKey: null));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Post_WrongApiKey_Returns401()
    {
        var res = await _client.SendAsync(PostRequest(apiKey: "wrong-key"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── X-Component-Id validation (422) ──────────────────────────────────────────

    [Fact]
    public async Task Post_MissingComponentId_Returns422()
    {
        var res = await _client.SendAsync(PostRequest(componentId: null));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Post_InvalidComponentId_Returns422()
    {
        var res = await _client.SendAsync(PostRequest(componentId: "BAD_Uppercase"));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    // ── Body validation (422) ─────────────────────────────────────────────────────

    [Fact]
    public async Task Post_InvalidState_Returns422()
    {
        var res = await _client.SendAsync(PostRequest(body: new
        {
            event_type = "status",
            state = "bogus",
            occurred_at = "2026-05-31T10:00:00Z",
        }));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    [Fact]
    public async Task Post_UnknownField_Returns422()
    {
        var res = await _client.SendAsync(PostRequest(body: new
        {
            event_type = "status",
            state = "running",
            occurred_at = "2026-05-31T10:00:00Z",
            surprise = "extra",
        }));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    // ── Payload size (413) ────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_PayloadOver8KiB_Returns413()
    {
        var big = new string('x', 9000);
        var res = await _client.SendAsync(PostRequest(body: new
        {
            event_type = "status",
            state = "running",
            occurred_at = "2026-05-31T10:00:00Z",
            payload = new { blob = big },
        }));
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
    }

    // ── Happy path (204) + round-trip ────────────────────────────────────────────

    [Fact]
    public async Task Post_Valid_Returns204()
    {
        var res = await _client.SendAsync(PostRequest(componentId: "demo-driver"));
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

}
