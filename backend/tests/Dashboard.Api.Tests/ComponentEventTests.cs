using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>POST /api/control/events</c> and <c>GET /api/control/events</c>.
/// Verifies X-Api-Key auth, X-Component-Id validation (422), body validation (422),
/// the 8 KiB payload limit (413), the 204 happy path, and listing + filters + paging.
/// Runs against a real Postgres container (Testcontainers).
/// </summary>
public sealed class ComponentEventTests : IAsyncLifetime
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

    private async Task PostEventAsync(string componentId, string eventType = "status", string state = "running")
    {
        var res = await _client.SendAsync(PostRequest(
            componentId: componentId,
            body: new { event_type = eventType, state, occurred_at = "2026-05-31T10:00:00Z" }));
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
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

    [Fact]
    public async Task PostThenGet_ReturnsStoredEvent()
    {
        const string component = "ce-roundtrip";
        var res = await _client.SendAsync(PostRequest(componentId: component, body: new
        {
            event_type = "status",
            state = "running",
            detail = "polling adapter",
            occurred_at = "2026-05-31T10:00:00Z",
            payload = new { adapter = "github-actions", count = 7 },
        }));
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);

        var page = await _client.GetFromJsonAsync<JsonElement>($"/api/control/events?component_id={component}");
        var items = page.GetProperty("items");
        Assert.Equal(1, items.GetArrayLength());

        var item = items[0];
        Assert.Equal(component, item.GetProperty("component_id").GetString());
        Assert.Equal("status", item.GetProperty("event_type").GetString());
        Assert.Equal("running", item.GetProperty("state").GetString());
        Assert.Equal("polling adapter", item.GetProperty("detail").GetString());
        // payload is re-emitted as a JSON object (not a quoted string).
        Assert.Equal(JsonValueKind.Object, item.GetProperty("payload").ValueKind);
        Assert.Equal("github-actions", item.GetProperty("payload").GetProperty("adapter").GetString());
    }

    // ── Listing filters + ordering + paging ──────────────────────────────────────

    [Fact]
    public async Task Get_FiltersByComponentId()
    {
        await PostEventAsync("ce-filter-a");
        await PostEventAsync("ce-filter-b");

        var page = await _client.GetFromJsonAsync<JsonElement>("/api/control/events?component_id=ce-filter-a");
        var items = page.GetProperty("items");

        Assert.True(items.GetArrayLength() >= 1);
        foreach (var item in items.EnumerateArray())
            Assert.Equal("ce-filter-a", item.GetProperty("component_id").GetString());
    }

    [Fact]
    public async Task Get_FiltersByEventType()
    {
        await PostEventAsync("ce-type", eventType: "heartbeat");
        await PostEventAsync("ce-type", eventType: "error", state: "error");

        var page = await _client.GetFromJsonAsync<JsonElement>(
            "/api/control/events?component_id=ce-type&event_type=heartbeat");
        var items = page.GetProperty("items");

        Assert.True(items.GetArrayLength() >= 1);
        foreach (var item in items.EnumerateArray())
            Assert.Equal("heartbeat", item.GetProperty("event_type").GetString());
    }

    [Fact]
    public async Task Get_NewestFirst_AndPagesWithCursor()
    {
        const string component = "ce-page";
        for (var i = 0; i < 3; i++)
            await PostEventAsync(component, eventType: $"evt-{i}");

        // limit=2 → first page has 2 items + a next_cursor.
        var first = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/control/events?component_id={component}&limit=2");
        Assert.Equal(2, first.GetProperty("items").GetArrayLength());
        var nextCursor = first.GetProperty("next_cursor").GetString();
        Assert.False(string.IsNullOrEmpty(nextCursor));

        // Second page picks up the remaining item.
        var second = await _client.GetFromJsonAsync<JsonElement>(
            $"/api/control/events?component_id={component}&limit=2&cursor={Uri.EscapeDataString(nextCursor!)}");
        Assert.Equal(1, second.GetProperty("items").GetArrayLength());
        Assert.Null(GetNullableString(second, "next_cursor"));
    }

    private static string? GetNullableString(JsonElement obj, string prop)
        => obj.TryGetProperty(prop, out var v) && v.ValueKind != JsonValueKind.Null ? v.GetString() : null;
}
