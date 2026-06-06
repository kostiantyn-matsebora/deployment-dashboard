using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Data;
using Microsoft.Extensions.DependencyInjection;

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

    // ── X-Correlation-Id validation (422) ────────────────────────────────────────

    [Fact]
    public async Task Post_CorrelationIdOver128Chars_Returns422WithPointer()
    {
        // 129 chars — exceeds the 128-char limit.
        var req = PostRequest(componentId: "demo-driver");
        req.Headers.Add("X-Correlation-Id", new string('a', 129));

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(
            errors.EnumerateArray().Any(e => e.GetProperty("pointer").GetString() == "/X-Correlation-Id"),
            "422 body must include an error with pointer /X-Correlation-Id.");
    }

    [Fact]
    public async Task Post_CorrelationIdLen1_Returns204()
    {
        // Boundary: length 1 is the minimum valid value.
        var req = PostRequest(componentId: "demo-driver");
        req.Headers.Add("X-Correlation-Id", "x");

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task Post_CorrelationIdLen128_Returns204()
    {
        // Boundary: length 128 is the maximum valid value.
        var req = PostRequest(componentId: "demo-driver");
        req.Headers.Add("X-Correlation-Id", new string('a', 128));

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task Post_NoCorrelationId_Returns204()
    {
        // Absent header is allowed — must not cause an error.
        var res = await _client.SendAsync(PostRequest(componentId: "demo-driver"));
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    // ── Persistence assertions ────────────────────────────────────────────────────

    [Fact]
    public async Task Post_WithCorrelationId_PersistsValueOnRow()
    {
        const string correlationValue = "persist-check-abc";

        var req = PostRequest(componentId: "persist-check-driver");
        req.Headers.Add("X-Correlation-Id", correlationValue);

        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var row = db.ComponentEvents
            .Where(e => e.ComponentId == "persist-check-driver")
            .OrderByDescending(e => e.ReceivedAt)
            .First();

        Assert.Equal(correlationValue, row.CorrelationId);
    }

    [Fact]
    public async Task Post_WithoutCorrelationId_PersistsNullOnRow()
    {
        var req = PostRequest(componentId: "persist-null-driver");
        // No X-Correlation-Id header.

        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var row = db.ComponentEvents
            .Where(e => e.ComponentId == "persist-null-driver")
            .OrderByDescending(e => e.ReceivedAt)
            .First();

        Assert.Null(row.CorrelationId);
    }

}
