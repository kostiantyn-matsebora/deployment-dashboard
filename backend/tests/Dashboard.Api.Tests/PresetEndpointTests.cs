using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for the repo/CI-sourced provided-presets surface (issue #391):
/// <c>PUT /api/presets/sources/{source}</c> (requires <c>X-Api-Key</c>) and
/// <c>GET /api/presets</c> (unauthenticated).
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class PresetEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public PresetEndpointTests(PostgresFixture fixture) => _fixture = fixture;

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

    private HttpRequestMessage PutRequest(string source, object body)
    {
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/presets/sources/{source}");
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        req.Content = JsonContent.Create(body);
        return req;
    }

    private static object Bundle(params object[] presets) => new { version = 1, presets };

    private static object PresetItem(string name, object settings) =>
        new { version = 1, name, settings };

    // ── Authentication ────────────────────────────────────────────────────────

    [Fact]
    public async Task PutPresetSource_MissingApiKey_Returns401ProblemJson()
    {
        var res = await _client.PutAsJsonAsync(
            "/api/presets/sources/acme/web",
            Bundle(PresetItem("default", new { theme = "dark" })));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task PutPresetSource_WrongApiKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Put, "/api/presets/sources/acme/web");
        req.Headers.Add("X-Api-Key", "wrong-key");
        req.Content = JsonContent.Create(Bundle(PresetItem("default", new { theme = "dark" })));

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task GetPresets_NoApiKey_Returns200()
    {
        var res = await _client.GetAsync("/api/presets");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    // ── PUT 204 + GET 200 round-trip, source attribution ────────────────────────

    [Fact]
    public async Task PutPresetSource_NewSource_Returns204()
    {
        var res = await _client.SendAsync(
            PutRequest("new-owner-put-204/repo", Bundle(PresetItem("default", new { theme = "dark" }))));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    [Fact]
    public async Task PutThenGetPresets_ReturnsStoredPresetWithSourceAttribution()
    {
        const string source = "roundtrip-owner/roundtrip-repo";

        await _client.SendAsync(PutRequest(
            source,
            Bundle(PresetItem("fast-rollout", new { theme = "dark", widgets = new[] { "matrix", "timeline" } }))));

        var getRes = await _client.GetAsync("/api/presets");
        Assert.Equal(HttpStatusCode.OK, getRes.StatusCode);

        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();
        var item = items.Single(i => i.GetProperty("source").GetString() == source);

        Assert.Equal("fast-rollout", item.GetProperty("name").GetString());
        Assert.Equal(1, item.GetProperty("version").GetInt32());
        Assert.True(item.TryGetProperty("fetched_at", out _), "Response must include fetched_at.");

        // settings must be re-emitted as a JSON object, not a re-escaped string.
        var settings = item.GetProperty("settings");
        Assert.Equal(JsonValueKind.Object, settings.ValueKind);
        Assert.Equal("dark", settings.GetProperty("theme").GetString());
    }

    [Fact]
    public async Task GetPresets_MergesAcrossSources()
    {
        const string sourceA = "merge-owner-a/repo";
        const string sourceB = "merge-owner-b/repo";

        await _client.SendAsync(PutRequest(sourceA, Bundle(PresetItem("preset-a", new { x = 1 }))));
        await _client.SendAsync(PutRequest(sourceB, Bundle(PresetItem("preset-b", new { x = 2 }))));

        var getRes = await _client.GetAsync("/api/presets");
        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();
        var sources = body.GetProperty("items").EnumerateArray()
            .Select(i => i.GetProperty("source").GetString())
            .ToList();

        Assert.Contains(sourceA, sources);
        Assert.Contains(sourceB, sources);
    }

    // ── PUT authoritative-replace ─────────────────────────────────────────────

    [Fact]
    public async Task PutPresetSource_SecondWrite_ReplacesPriorPresetsForSource()
    {
        const string source = "replace-owner/replace-repo";

        await _client.SendAsync(PutRequest(source, Bundle(PresetItem("preset-v1", new { x = 1 }))));
        await _client.SendAsync(PutRequest(source, Bundle(PresetItem("preset-v2", new { x = 2 }))));

        var getRes = await _client.GetAsync("/api/presets");
        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();
        var namesForSource = body.GetProperty("items").EnumerateArray()
            .Where(i => i.GetProperty("source").GetString() == source)
            .Select(i => i.GetProperty("name").GetString())
            .ToList();

        Assert.Equal(["preset-v2"], namesForSource);
    }

    [Fact]
    public async Task PutPresetSource_EmptyPresetsArray_PrunesAllForSource()
    {
        const string source = "prune-owner/prune-repo";

        await _client.SendAsync(PutRequest(source, Bundle(PresetItem("preset-to-be-pruned", new { x = 1 }))));

        var pruneRes = await _client.SendAsync(PutRequest(source, Bundle()));
        Assert.Equal(HttpStatusCode.NoContent, pruneRes.StatusCode);

        var getRes = await _client.GetAsync("/api/presets");
        var body = await getRes.Content.ReadFromJsonAsync<JsonElement>();
        var namesForSource = body.GetProperty("items").EnumerateArray()
            .Where(i => i.GetProperty("source").GetString() == source)
            .ToList();

        Assert.Empty(namesForSource);
    }

    // ── PUT validation ────────────────────────────────────────────────────────

    [Fact]
    public async Task PutPresetSource_BundleOverSizeLimit_Returns413ProblemJson()
    {
        // Each preset's settings blob is ~50 KiB; six of them push the serialised bundle past 256 KiB.
        var bigValue = new string('x', 50_000);
        var presets = Enumerable.Range(0, 6)
            .Select(i => PresetItem($"oversize-{i}", new { blob = bigValue }))
            .ToArray();

        var res = await _client.SendAsync(PutRequest("oversize-owner/oversize-repo", Bundle(presets)));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task PutPresetSource_UnknownField_Returns422ProblemJson()
    {
        var req = new HttpRequestMessage(HttpMethod.Put, "/api/presets/sources/unknown-field-owner/repo");
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        req.Content = JsonContent.Create(new
        {
            version = 1,
            presets = new[] { PresetItem("default", new { theme = "dark" }) },
            extra_field = "should-fail",
        });

        var res = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }
}
