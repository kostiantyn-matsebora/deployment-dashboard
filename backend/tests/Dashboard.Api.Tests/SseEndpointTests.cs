using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>GET /api/events/stream</c>.
///
/// Two test classes share a layout:
/// <list type="bullet">
///   <item><see cref="SseReplayTests"/> — verifies <c>Last-Event-ID</c> replay using the
///     standard factory (NullNotifier). No live LISTEN/NOTIFY needed.</item>
///   <item><see cref="SseLiveStreamTests"/> — verifies real-time fan-out using a factory
///     configured with <c>UseRealNotifier = true</c> so that ingest → pg_notify → broadcaster
///     → SSE client path is fully exercised.</item>
/// </list>
/// </summary>

// ── Replay (NullNotifier) ─────────────────────────────────────────────────────

public sealed class SseReplayTests : IAsyncLifetime
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

    private async Task<JsonElement> IngestAsync(
        string service = "sse-svc",
        string happenedAt = "2026-05-29T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<List<string>> ReadSseEventIdsAsync(
        Stream stream,
        int count,
        CancellationToken ct)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var ids = new List<string>();

        while (ids.Count < count && !ct.IsCancellationRequested)
        {
            string? line;
            try { line = await reader.ReadLineAsync(ct); }
            catch (OperationCanceledException) { break; }

            if (line is null) break;
            if (!line.StartsWith("data: ")) continue;

            var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
            ids.Add(json.GetProperty("id").GetString()!);
        }

        return ids;
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task StreamEvents_Returns200WithEventStreamContentType()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        using var response = await _client.GetAsync(
            "/api/events/stream",
            HttpCompletionOption.ResponseHeadersRead,
            cts.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task StreamEvents_Replay_ReturnsEventsSinceLastEventId()
    {
        // Seed 3 events with distinct happened_at so ordering is deterministic.
        var ev1 = await IngestAsync(service: "replay-a", happenedAt: "2020-01-01T00:00:00Z");
        var ev2 = await IngestAsync(service: "replay-a", happenedAt: "2020-01-01T01:00:00Z");
        var ev3 = await IngestAsync(service: "replay-a", happenedAt: "2020-01-01T02:00:00Z");

        var id1 = ev1.GetProperty("id").GetString()!;
        var id2 = ev2.GetProperty("id").GetString()!;
        var id3 = ev3.GetProperty("id").GetString()!;

        // Connect with Last-Event-ID = id1 → should replay ev2 and ev3 only.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream?service=replay-a");
        request.Headers.Add("Last-Event-ID", id1);

        using var response = await _client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        var receivedIds = await ReadSseEventIdsAsync(stream, count: 2, cts.Token);

        Assert.Equal(2, receivedIds.Count);
        Assert.Contains(id2, receivedIds);
        Assert.Contains(id3, receivedIds);
        Assert.DoesNotContain(id1, receivedIds);
    }

    [Fact]
    public async Task StreamEvents_Replay_ServiceFilter_ExcludesOtherServices()
    {
        var evTarget = await IngestAsync(service: "replay-filter-target", happenedAt: "2020-02-01T00:00:00Z");
        var evOther = await IngestAsync(service: "replay-filter-other", happenedAt: "2020-02-01T01:00:00Z");

        var targetId = evTarget.GetProperty("id").GetString()!;
        var otherId = evOther.GetProperty("id").GetString()!;

        // Use a resume id that is lexicographically before both events (zero UUID).
        var zeroId = Guid.Empty.ToString();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        var request = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/events/stream?service=replay-filter-target");
        request.Headers.Add("Last-Event-ID", zeroId);

        using var response = await _client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        var receivedIds = await ReadSseEventIdsAsync(stream, count: 1, cts.Token);

        Assert.Contains(targetId, receivedIds);
        Assert.DoesNotContain(otherId, receivedIds);
    }

    [Fact]
    public async Task StreamEvents_Replay_EmptyWhenNoEventsAfterCursor()
    {
        var ev = await IngestAsync(service: "replay-empty", happenedAt: "2020-03-01T00:00:00Z");
        var evId = ev.GetProperty("id").GetString()!;

        // Resume from the last event's own id → nothing newer exists.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));

        var request = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/events/stream?service=replay-empty");
        request.Headers.Add("Last-Event-ID", evId);

        using var response = await _client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        // The stream opens but no data lines arrive (only possible ping comments).
        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        var receivedIds = await ReadSseEventIdsAsync(stream, count: 1, cts.Token);

        Assert.Empty(receivedIds);
    }
}

// ── Live stream (real notifier + LISTEN/NOTIFY) ───────────────────────────────

public sealed class SseLiveStreamTests : IAsyncLifetime
{
    // UseRealNotifier = true: PostgresDeploymentNotifier issues pg_notify on ingest,
    // and DeploymentEventBroadcaster's LISTEN loop receives and fans out the event.
    private readonly TestApiFactory _factory = new() { UseRealNotifier = true };
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

    private async Task<JsonElement> IngestAsync(string service = "sse-live-svc")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = "2026-05-29T12:00:00Z",
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task StreamEvents_LiveEvent_ReceivedOnStream()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        // Open the SSE stream and filter to a service used only by this test.
        var sseRequest = new HttpRequestMessage(
            HttpMethod.Get,
            "/api/events/stream?service=sse-live-fanout");

        using var sseResponse = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, sseResponse.StatusCode);

        await using var stream = await sseResponse.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        var receivedId = new TaskCompletionSource<string>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        // Read the SSE stream in the background.
        var readTask = Task.Run(async () =>
        {
            while (!cts.IsCancellationRequested)
            {
                string? line;
                try { line = await reader.ReadLineAsync(cts.Token); }
                catch (OperationCanceledException) { break; }

                if (line is null) break;
                if (!line.StartsWith("data: ")) continue;

                var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
                receivedId.TrySetResult(json.GetProperty("id").GetString()!);
                break;
            }
        }, cts.Token);

        // Brief pause to let the SSE subscription register before ingesting.
        await Task.Delay(300, cts.Token);

        // Ingest the event — this triggers pg_notify → broadcaster → channel fan-out.
        var ingested = await IngestAsync(service: "sse-live-fanout");
        var expectedId = ingested.GetProperty("id").GetString()!;

        // Wait for the event to propagate through LISTEN/NOTIFY → broadcaster → SSE handler.
        var arrived = await receivedId.Task.WaitAsync(cts.Token);

        Assert.Equal(expectedId, arrived);

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }
    }
}
