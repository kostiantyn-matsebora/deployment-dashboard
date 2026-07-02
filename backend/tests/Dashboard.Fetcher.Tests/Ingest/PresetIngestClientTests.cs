using System.Net;
using System.Net.Http;
using System.Text.Json;
using Dashboard.Fetcher.Ingest;

namespace Dashboard.Fetcher.Tests.Ingest;

/// <summary>
/// Unit tests for <see cref="PresetIngestClient"/> — the PUT /api/presets/sources/{source}
/// HTTP client (issue #391 / §5.6.2). No real network — an in-memory
/// <see cref="HttpMessageHandler"/> captures the request.
/// </summary>
public sealed class PresetIngestClientTests
{
    [Fact]
    public async Task PutAsync_SendsLiteralSlashInPath_ForCatchAllRoute()
    {
        // docs/api/openapi.yaml: the backend matches `{source}` with a catch-all route and
        // expects the literal `/` (owner/repo) in the path — not %2F.
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new PresetIngestClient(MakeHttpClient(handler));

        await client.PutAsync("acme/web", [], default);

        Assert.Equal("/api/presets/sources/acme/web", handler.LastRequest!.RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task PutAsync_EmptyPresets_SendsEmptyArray_PruneAllBundle()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new PresetIngestClient(MakeHttpClient(handler));

        await client.PutAsync("acme/web", [], default);

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(1, doc.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(0, doc.RootElement.GetProperty("presets").GetArrayLength());
    }

    [Fact]
    public async Task PutAsync_WithPresets_BuildsAnonymousBundleShape()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new PresetIngestClient(MakeHttpClient(handler));

        using var settingsDoc = JsonDocument.Parse("""{"theme":"dark"}""");
        var presets = new List<PresetEntry> { new("Prod defaults", settingsDoc.RootElement.Clone()) };

        await client.PutAsync("acme/web", presets, default);

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var items = doc.RootElement.GetProperty("presets");
        Assert.Equal(1, items.GetArrayLength());
        var first = items[0];
        Assert.Equal(1, first.GetProperty("version").GetInt32());
        Assert.Equal("Prod defaults", first.GetProperty("name").GetString());
        Assert.Equal("dark", first.GetProperty("settings").GetProperty("theme").GetString());
    }

    [Fact]
    public async Task PutAsync_NonSuccessStatus_Throws()
    {
        var handler = new CapturingHandler(HttpStatusCode.Unauthorized);
        var client = new PresetIngestClient(MakeHttpClient(handler));

        await Assert.ThrowsAsync<HttpRequestException>(() => client.PutAsync("acme/web", [], default));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static HttpClient MakeHttpClient(HttpMessageHandler handler)
    {
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://api:8080") };
        http.DefaultRequestHeaders.Add("X-Api-Key", "test-key");
        return http;
    }

    private sealed class CapturingHandler(HttpStatusCode statusCode) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if (request.Content is not null)
            {
                var bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
                request.Content = new ByteArrayContent(bytes);
                request.Content.Headers.ContentType =
                    System.Net.Http.Headers.MediaTypeHeaderValue.Parse("application/json; charset=utf-8");
            }
            LastRequest = request;
            return new HttpResponseMessage(statusCode);
        }
    }
}
