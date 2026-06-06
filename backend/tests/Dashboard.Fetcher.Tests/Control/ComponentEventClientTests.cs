using System.Net;
using System.Text.Json;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Control;

/// <summary>
/// §265 — unit tests for X-Correlation-Id header behaviour on
/// <see cref="ComponentEventClient.PostAckAsync"/> and
/// <see cref="ComponentEventClient.PostRunningAsync"/>.
/// Verifies the header is sent with the correct reset-id value on reset-related posts
/// and omitted on non-reset posts (rate-limit).
/// No real network — all HTTP is handled by an in-memory <see cref="HttpMessageHandler"/>.
/// </summary>
public sealed class ComponentEventClientTests
{
    // ── PostAckAsync (reset-ack) ──────────────────────────────────────────────

    [Fact]
    public async Task PostAckAsync_SetsXCorrelationIdHeader()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostAckAsync("reset-evt-001", default);

        Assert.True(handler.LastRequest!.Headers.Contains("X-Correlation-Id"),
            "X-Correlation-Id header must be present on reset-ack posts");
    }

    [Fact]
    public async Task PostAckAsync_XCorrelationIdMatchesResetId()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostAckAsync("reset-evt-abc", default);

        var value = handler.LastRequest!.Headers.GetValues("X-Correlation-Id").Single();
        Assert.Equal("reset-evt-abc", value);
    }

    [Fact]
    public async Task PostAckAsync_BodyHasNoResetId()
    {
        // X-Correlation-Id is the sole correlation carrier — payload must have no reset_id.
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostAckAsync("reset-evt-001", default);

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.False(doc.RootElement.TryGetProperty("payload", out _),
            "Body must not contain a payload field when there is no payload");
    }

    // ── PostRunningAsync (post-reset status) ──────────────────────────────────

    [Fact]
    public async Task PostRunningAsync_SetsXCorrelationIdHeader()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostRunningAsync("reset-evt-002", default);

        Assert.True(handler.LastRequest!.Headers.Contains("X-Correlation-Id"),
            "X-Correlation-Id header must be present on post-reset status posts");
    }

    [Fact]
    public async Task PostRunningAsync_XCorrelationIdMatchesResetId()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostRunningAsync("reset-evt-xyz", default);

        var value = handler.LastRequest!.Headers.GetValues("X-Correlation-Id").Single();
        Assert.Equal("reset-evt-xyz", value);
    }

    [Fact]
    public async Task PostRunningAsync_BodyHasNoResetId()
    {
        // X-Correlation-Id optionally correlates recovery — payload must have no reset_id.
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostRunningAsync("reset-evt-002", default);

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        Assert.False(doc.RootElement.TryGetProperty("payload", out _),
            "Body must not contain a payload field when there is no payload");
    }

    // ── PostRateLimitAsync (non-reset) — header must be absent ───────────────

    [Fact]
    public async Task PostRateLimitAsync_OmitsXCorrelationIdHeader()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var client = new ComponentEventClient(MakeHttpClient(handler), NullLogger<ComponentEventClient>.Instance);

        await client.PostRateLimitAsync(MakeSnapshot(), "github-actions", "running", default);

        Assert.False(handler.LastRequest!.Headers.Contains("X-Correlation-Id"),
            "X-Correlation-Id must not be set on non-reset (rate-limit) posts");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static RateLimitSnapshot MakeSnapshot()
        => new(Used: 10, Budget: 1000, ResetAt: DateTimeOffset.UtcNow.AddHours(1));

    private static HttpClient MakeHttpClient(HttpMessageHandler handler)
    {
        var http = new HttpClient(handler) { BaseAddress = new Uri("http://api:8080") };
        http.DefaultRequestHeaders.Add("X-Api-Key", "test-key");
        http.DefaultRequestHeaders.Add("X-Component-Id", "dashboard-fetcher");
        return http;
    }

    private sealed class CapturingHandler(HttpStatusCode statusCode) : HttpMessageHandler
    {
        public HttpRequestMessage? LastRequest { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            // Buffer the content so it can be re-read
            if (request.Content is not null)
            {
                var bytes = await request.Content.ReadAsByteArrayAsync(cancellationToken);
                request.Content = new System.Net.Http.ByteArrayContent(bytes);
                request.Content.Headers.ContentType =
                    System.Net.Http.Headers.MediaTypeHeaderValue.Parse("application/json; charset=utf-8");
            }
            LastRequest = request;
            return new HttpResponseMessage(statusCode);
        }
    }
}
