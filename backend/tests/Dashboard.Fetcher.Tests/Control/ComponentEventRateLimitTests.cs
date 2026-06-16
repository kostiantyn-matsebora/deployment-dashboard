using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Control;

/// <summary>
/// F18 / §5.11 — unit tests for <see cref="ComponentEventClient.PostRateLimitAsync"/>.
/// Verifies the JSON body shape, required headers, reset_at null-when-MinValue rule,
/// and non-fatal error handling.
/// No real network — all HTTP is handled by an in-memory <see cref="HttpMessageHandler"/>.
/// </summary>
public sealed class ComponentEventRateLimitTests
{
    // ── JSON body shape ───────────────────────────────────────────────────────

    [Fact]
    public async Task PostRateLimitAsync_EmitsCorrectEventType()
    {
        var captured = await CaptureRequestAsync(MakeSnapshot());

        Assert.Equal("rate-limit", captured.EventType);
    }

    [Fact]
    public async Task PostRateLimitAsync_EmitsSuppliedState()
    {
        var captured = await CaptureRequestAsync(MakeSnapshot(), state: "paused");

        Assert.Equal("paused", captured.State);
    }

    [Fact]
    public async Task PostRateLimitAsync_PayloadContainsAdapter()
    {
        var captured = await CaptureRequestAsync(MakeSnapshot(), adapterId: "github-actions");

        Assert.Equal("github-actions", captured.Payload.GetProperty("adapter").GetString());
    }

    [Fact]
    public async Task PostRateLimitAsync_PayloadContainsCiLimit()
    {
        var snapshot = MakeSnapshot(ciLimit: 5000, ciRemaining: 4830);
        var captured = await CaptureRequestAsync(snapshot);

        Assert.Equal(5000, captured.Payload.GetProperty("ci_limit").GetInt32());
    }

    [Fact]
    public async Task PostRateLimitAsync_PayloadContainsCiRemaining()
    {
        var snapshot = MakeSnapshot(ciLimit: 5000, ciRemaining: 4830);
        var captured = await CaptureRequestAsync(snapshot);

        Assert.Equal(4830, captured.Payload.GetProperty("ci_remaining").GetInt32());
    }

    [Fact]
    public async Task PostRateLimitAsync_PayloadContainsOwnBudget()
    {
        var snapshot = new RateLimitSnapshot(Used: 170, Budget: 2500, ResetAt: DateTimeOffset.UtcNow.AddHours(1));
        var captured = await CaptureRequestAsync(snapshot);

        Assert.Equal(2500, captured.Payload.GetProperty("own_budget").GetInt32());
    }

    [Fact]
    public async Task PostRateLimitAsync_PayloadContainsOwnUsed()
    {
        var snapshot = new RateLimitSnapshot(Used: 170, Budget: 2500, ResetAt: DateTimeOffset.UtcNow.AddHours(1));
        var captured = await CaptureRequestAsync(snapshot);

        Assert.Equal(170, captured.Payload.GetProperty("own_used").GetInt32());
    }

    [Fact]
    public async Task PostRateLimitAsync_ResetAt_PresentWhenNotMinValue()
    {
        var resetAt = new DateTimeOffset(2026, 6, 1, 11, 0, 0, TimeSpan.Zero);
        var snapshot = new RateLimitSnapshot(Used: 1, Budget: 100, ResetAt: resetAt);
        var captured = await CaptureRequestAsync(snapshot);

        Assert.False(captured.Payload.GetProperty("reset_at").ValueKind == JsonValueKind.Null,
            "reset_at should be non-null when ResetAt != MinValue");
    }

    [Fact]
    public async Task PostRateLimitAsync_ResetAt_NullWhenMinValue()
    {
        var snapshot = new RateLimitSnapshot(Used: 1, Budget: 100, ResetAt: DateTimeOffset.MinValue);
        var captured = await CaptureRequestAsync(snapshot);

        // JsonIgnoreCondition.WhenWritingNull omits null fields entirely.
        // Absent or JsonValueKind.Null both mean "no value".
        var present = captured.Payload.TryGetProperty("reset_at", out var prop);
        Assert.True(!present || prop.ValueKind == JsonValueKind.Null,
            "reset_at should be absent or null when ResetAt == MinValue");
    }

    [Fact]
    public async Task PostRateLimitAsync_CiLimit_NullWhenSnapshotHasNullCiLimit()
    {
        var snapshot = new RateLimitSnapshot(Used: 1, Budget: 100, ResetAt: DateTimeOffset.UtcNow.AddHours(1),
            CiLimit: null, CiRemaining: null);
        var captured = await CaptureRequestAsync(snapshot);

        // JsonIgnoreCondition.WhenWritingNull omits null fields; absent == null for consumers.
        var ciLimitPresent = captured.Payload.TryGetProperty("ci_limit", out var ciLimitProp);
        Assert.True(!ciLimitPresent || ciLimitProp.ValueKind == JsonValueKind.Null,
            "ci_limit should be absent or null when CiLimit is null");

        var ciRemainingPresent = captured.Payload.TryGetProperty("ci_remaining", out var ciRemainingProp);
        Assert.True(!ciRemainingPresent || ciRemainingProp.ValueKind == JsonValueKind.Null,
            "ci_remaining should be absent or null when CiRemaining is null");
    }

    // ── Required headers ─────────────────────────────────────────────────────

    [Fact]
    public async Task PostRateLimitAsync_SetsXApiKeyHeader()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var http = MakeHttpClient(handler, apiKey: "test-api-key", componentId: "dashboard-fetcher");

        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);
        await client.PostRateLimitAsync(MakeSnapshot(), "github-actions", "running", default);

        Assert.True(handler.LastRequest!.Headers.Contains("X-Api-Key"));
        Assert.Equal("test-api-key", handler.LastRequest.Headers.GetValues("X-Api-Key").First());
    }

    [Fact]
    public async Task PostRateLimitAsync_SetsXComponentIdHeader()
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var http = MakeHttpClient(handler, apiKey: "key", componentId: "dashboard-fetcher");

        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);
        await client.PostRateLimitAsync(MakeSnapshot(), "github-actions", "running", default);

        Assert.True(handler.LastRequest!.Headers.Contains("X-Component-Id"));
        Assert.Equal("dashboard-fetcher", handler.LastRequest.Headers.GetValues("X-Component-Id").First());
    }

    // ── Non-fatal resilience ─────────────────────────────────────────────────

    [Fact]
    public async Task PostRateLimitAsync_Non2xxResponse_DoesNotThrow()
    {
        var handler = new CapturingHandler(HttpStatusCode.InternalServerError);
        var http = MakeHttpClient(handler);

        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);

        // Must not throw
        await client.PostRateLimitAsync(MakeSnapshot(), "github-actions", "running", default);
    }

    [Fact]
    public async Task PostRateLimitAsync_TransportError_DoesNotThrow()
    {
        var handler = new ThrowingHandler();
        var http = MakeHttpClient(handler);

        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);

        // Must not throw
        await client.PostRateLimitAsync(MakeSnapshot(), "github-actions", "running", default);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static RateLimitSnapshot MakeSnapshot(
        int used = 170,
        int budget = 2500,
        int? ciLimit = 5000,
        int? ciRemaining = 4830)
        => new(Used: used, Budget: budget,
            ResetAt: DateTimeOffset.UtcNow.AddHours(1),
            CiLimit: ciLimit, CiRemaining: ciRemaining);

    private static async Task<CapturedBody> CaptureRequestAsync(
        RateLimitSnapshot snapshot,
        string adapterId = "github-actions",
        string state = "running")
    {
        var handler = new CapturingHandler(HttpStatusCode.NoContent);
        var http = MakeHttpClient(handler);
        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);

        await client.PostRateLimitAsync(snapshot, adapterId, state, default);

        var json = await handler.LastRequest!.Content!.ReadAsStringAsync();
        return ParseBody(json);
    }

    private static CapturedBody ParseBody(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        return new CapturedBody(
            EventType: root.GetProperty("event_type").GetString()!,
            State: root.GetProperty("state").GetString()!,
            Payload: root.GetProperty("payload").Clone());
    }

    private static HttpClient MakeHttpClient(
        HttpMessageHandler handler,
        string apiKey = "test-key",
        string componentId = "dashboard-fetcher")
    {
        var http = new HttpClient(handler)
        {
            BaseAddress = new Uri("http://api:8080"),
        };
        http.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        http.DefaultRequestHeaders.Add("X-Component-Id", componentId);
        return http;
    }

    private sealed record CapturedBody(string EventType, string State, JsonElement Payload);

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
                request.Content = new ByteArrayContent(bytes);
                request.Content.Headers.ContentType =
                    System.Net.Http.Headers.MediaTypeHeaderValue.Parse("application/json; charset=utf-8");
            }
            LastRequest = request;
            return new HttpResponseMessage(statusCode);
        }
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("simulated transport failure");
    }
}
