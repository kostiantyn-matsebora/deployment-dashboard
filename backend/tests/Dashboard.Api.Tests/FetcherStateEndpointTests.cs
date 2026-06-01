using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for the fetcher-state surface:
/// <c>GET /api/fetcher/state/{adapter}</c> and <c>PUT /api/fetcher/state/{adapter}</c>.
///
/// Both endpoints require <c>X-Api-Key</c>.
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class FetcherStateEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public FetcherStateEndpointTests(PostgresFixture fixture) => _fixture = fixture;

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

    private HttpRequestMessage GetRequest(string adapter) =>
        AuthorizedRequest(HttpMethod.Get, $"/api/fetcher/state/{adapter}");

    private HttpRequestMessage PutRequest(string adapter, object body)
    {
        var req = AuthorizedRequest(HttpMethod.Put, $"/api/fetcher/state/{adapter}");
        req.Content = JsonContent.Create(body);
        return req;
    }

    private static HttpRequestMessage AuthorizedRequest(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        return req;
    }

    // ── Authentication ────────────────────────────────────────────────────────

    [Fact]
    public async Task GetFetcherState_MissingApiKey_Returns401ProblemJson()
    {
        var res = await _client.GetAsync("/api/fetcher/state/github-actions");

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task PutFetcherState_MissingApiKey_Returns401()
    {
        var res = await _client.PutAsJsonAsync(
            "/api/fetcher/state/github-actions",
            new { cursor = "abc" });

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task GetFetcherState_WrongApiKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/github-actions");
        req.Headers.Add("X-Api-Key", "wrong-key");

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── GET — 404 when adapter has no state ──────────────────────────────────

    [Fact]
    public async Task GetFetcherState_UnknownAdapter_Returns404ProblemJson()
    {
        var res = await _client.SendAsync(GetRequest("never-stored-adapter-z99z"));

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    // ── PUT 204 + GET 200 round-trip ──────────────────────────────────────────

    [Fact]
    public async Task PutFetcherState_NewAdapter_Returns204()
    {
        var res = await _client.SendAsync(
            PutRequest("new-adapter-put-204", new { cursor = "cursor-value" }));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task PutThenGetFetcherState_ReturnsStoredCursorAndAdapter()
    {
        const string adapter = "round-trip-adapter";
        const string cursor = "opaque-cursor-blob";

        await _client.SendAsync(PutRequest(adapter, new { cursor }));

        var getRes = await _client.SendAsync(GetRequest(adapter));

        Assert.Equal(HttpStatusCode.OK, getRes.StatusCode);
        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(adapter, body.GetProperty("adapter").GetString());
        Assert.Equal(cursor, body.GetProperty("cursor").GetString());
        Assert.True(body.TryGetProperty("updated_at", out _), "Response must include updated_at.");
    }

    // ── PUT upsert (latest write wins) ────────────────────────────────────────

    [Fact]
    public async Task PutFetcherState_SecondWrite_OverwritesCursor()
    {
        const string adapter = "upsert-adapter";

        await _client.SendAsync(PutRequest(adapter, new { cursor = "cursor-v1" }));
        await _client.SendAsync(PutRequest(adapter, new { cursor = "cursor-v2" }));

        var getRes = await _client.SendAsync(GetRequest(adapter));
        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("cursor-v2", body.GetProperty("cursor").GetString());
    }

    // ── PUT validation ────────────────────────────────────────────────────────

    [Fact]
    public async Task PutFetcherState_CursorExceeds8192Chars_Returns413ProblemJson()
    {
        var oversizeCursor = new string('x', 8193);

        var res = await _client.SendAsync(
            PutRequest("large-cursor-adapter", new { cursor = oversizeCursor }));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task PutFetcherState_ExactlyAtLimit_Returns204()
    {
        var cursorAtLimit = new string('x', 8192);

        var res = await _client.SendAsync(
            PutRequest("limit-adapter", new { cursor = cursorAtLimit }));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task PutFetcherState_UnknownField_Returns422()
    {
        var res = await _client.SendAsync(
            PutRequest("unknown-field-adapter",
                new { cursor = "abc", extra_field = "should-fail" }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }
}
