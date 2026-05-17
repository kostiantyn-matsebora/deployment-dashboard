using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// CR-0008 § Standardised error response + Decision 6: Read-API 4xx
/// responses return <c>application/problem+json</c> (RFC 7807). Covers
/// the two 4xx surfaces exposed by the Read API today:
///
/// <list type="bullet">
///   <item>404 — slot/history not found.</item>
///   <item>400 — unknown <c>correlationAttribute</c> query value.</item>
/// </list>
/// </summary>
public sealed class ReadApiProblemDetailsTests : IClassFixture<TestApplicationFactory>
{
    private readonly HttpClient _client;

    public ReadApiProblemDetailsTests(TestApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task SlotNotFound_Returns404_WithProblemJsonBody()
    {
        var resp = await _client.GetAsync("/api/deployments/nonexistent-svc/dev");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json",
            resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(404, body.GetProperty("status").GetInt32());
        Assert.True(body.TryGetProperty("title", out _));
        Assert.True(body.TryGetProperty("detail", out var detail));
        Assert.Contains("nonexistent-svc", detail.GetString());
    }

    [Fact]
    public async Task HistoryNotFound_Returns404_WithProblemJsonBody()
    {
        var resp = await _client.GetAsync("/api/deployments/nonexistent-svc/dev/history");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json",
            resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(404, body.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task UnknownCorrelationAttribute_Returns400_WithProblemJsonBody()
    {
        // Pre-existing 400 contract is preserved; the body is now standardised
        // to ProblemDetails with the `error` slug + `attribute` extra retained
        // as extension entries.
        var resp = await _client.GetAsync("/api/deployments?correlationAttribute=zzz");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("application/problem+json",
            resp.Content.Headers.ContentType?.MediaType);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(400, body.GetProperty("status").GetInt32());
        Assert.Equal("invalid_correlation_attribute", body.GetProperty("error").GetString());
        Assert.Equal("zzz", body.GetProperty("attribute").GetString());
    }
}
