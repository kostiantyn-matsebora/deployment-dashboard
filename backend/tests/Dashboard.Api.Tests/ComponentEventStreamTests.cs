using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>GET /api/control/events/stream</c>:
/// no-auth open, <c>Last-Event-ID</c> replay from <c>component_events</c>,
/// and live fan-out via LISTEN/NOTIFY after <c>POST /api/control/events</c>.
/// Mirrors <see cref="ControlStreamTests"/>. Runs against the shared Postgres
/// container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class ComponentEventStreamTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ComponentEventStreamTests(PostgresFixture fixture) => _fixture = fixture;

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

    /// <summary>POSTs a valid component event and asserts 204. Returns immediately.</summary>
    private async Task PostEventAsync(
        string componentId = "demo-driver",
        string eventType = "status",
        string state = "running")
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = eventType,
                state,
                occurred_at = "2026-05-31T10:00:00Z",
            }),
        };
        req.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        req.Headers.Add("X-Component-Id", componentId);

        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
    }

    private HttpRequestMessage StreamRequest(string? lastEventId = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/control/events/stream");
        // No auth header — the stream is unauthenticated (§11, auth table).
        if (lastEventId is not null) req.Headers.Add("Last-Event-ID", lastEventId);
        return req;
    }

    /// <summary>
    /// Reads lines from an SSE stream until <paramref name="count"/> <c>data:</c>
    /// frames are collected or the timeout fires.
    /// </summary>
    private static async Task<List<JsonElement>> ReadDataFramesAsync(
        Stream stream, int count, CancellationToken ct)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var events = new List<JsonElement>();

        while (events.Count < count && !ct.IsCancellationRequested)
        {
            string? line;
            try { line = await reader.ReadLineAsync(ct); }
            catch (OperationCanceledException) { break; }

            if (line is null) break;
            if (!line.StartsWith("data: ")) continue;

            events.Add(JsonSerializer.Deserialize<JsonElement>(line[6..]));
        }

        return events;
    }

    // ── Auth — no X-Api-Key required ─────────────────────────────────────────

    [Fact]
    public async Task Stream_NoAuthHeader_Returns200EventStream()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var res = await _client.SendAsync(
            StreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/event-stream", res.Content.Headers.ContentType?.MediaType);
    }

    // ── Last-Event-ID replay ─────────────────────────────────────────────────

    [Fact]
    public async Task Stream_Replay_ReturnsEventsSinceLastEventId()
    {
        // Post three events so we have rows in the DB.
        await PostEventAsync("cs-replay-a");
        await PostEventAsync("cs-replay-b");
        await PostEventAsync("cs-replay-c");

        // Open the stream without Last-Event-ID to drain current IDs.
        // Instead, query the stream with Last-Event-ID=Guid.Empty so all three replay.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await _client.SendAsync(
            StreamRequest(lastEventId: Guid.Empty.ToString()),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var frames = await ReadDataFramesAsync(stream, count: 3, cts.Token);

        Assert.True(frames.Count >= 3, $"Expected at least 3 replayed frames, got {frames.Count}.");
        foreach (var f in frames)
            Assert.True(f.TryGetProperty("id", out _), "Each replayed frame must carry an 'id' field.");
    }

    [Fact]
    public async Task Stream_Replay_EventsBetweenTwoIds()
    {
        // Post event A, capture its id (by reading the stream briefly), then post B.
        // Connect with Last-Event-ID=A.id and assert B is replayed but A is not.

        // Post A and B.
        await PostEventAsync("cs-ab-a", eventType: "status");
        await PostEventAsync("cs-ab-b", eventType: "heartbeat");

        // Drain: open stream with Guid.Empty to read all events so far (≥2).
        using var drainCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var drainRes = await _client.SendAsync(
            StreamRequest(lastEventId: Guid.Empty.ToString()),
            HttpCompletionOption.ResponseHeadersRead, drainCts.Token);
        await using var drainStream = await drainRes.Content.ReadAsStreamAsync(drainCts.Token);
        var allFrames = await ReadDataFramesAsync(drainStream, count: 2, drainCts.Token);

        Assert.True(allFrames.Count >= 2, "Should have replayed at least 2 events.");

        // Extract the id of the first frame (event A's row).
        var idA = allFrames[0].GetProperty("id").GetString()!;
        var idB = allFrames[1].GetProperty("id").GetString()!;

        // Now reconnect with Last-Event-ID=idA — only B should replay.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await _client.SendAsync(
            StreamRequest(lastEventId: idA),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var replayedFrames = await ReadDataFramesAsync(stream, count: 1, cts.Token);

        var replayedIds = replayedFrames.Select(f => f.GetProperty("id").GetString()).ToList();
        Assert.Contains(idB, replayedIds);
        Assert.DoesNotContain(idA, replayedIds);
    }

    [Fact]
    public async Task Stream_Replay_EmptyWhenNothingAfterCursor()
    {
        // Post one event, then replay from its id — nothing more should arrive.
        await PostEventAsync("cs-empty-replay");

        // Read the id via a full drain replay.
        using var drainCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var drainRes = await _client.SendAsync(
            StreamRequest(lastEventId: Guid.Empty.ToString()),
            HttpCompletionOption.ResponseHeadersRead, drainCts.Token);
        await using var drainStream = await drainRes.Content.ReadAsStreamAsync(drainCts.Token);
        var initial = await ReadDataFramesAsync(drainStream, count: 1, drainCts.Token);
        Assert.True(initial.Count >= 1);
        var lastId = initial.Last().GetProperty("id").GetString()!;

        // Reconnect from lastId — no events beyond it should replay.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var res = await _client.SendAsync(
            StreamRequest(lastEventId: lastId),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var frames = await ReadDataFramesAsync(stream, count: 1, cts.Token);

        Assert.Empty(frames);
    }

    // ── Live fan-out (LISTEN/NOTIFY) ─────────────────────────────────────────

    [Fact]
    public async Task Stream_Live_ReceivesComponentEventFrame()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        // Open the SSE stream — no auth needed.
        using var res = await _client.SendAsync(
            StreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        // Collect the event name and data lines for the first received frame.
        string? receivedEventName = null;
        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(async () =>
        {
            string? pendingEventName = null;
            while (!cts.IsCancellationRequested)
            {
                string? line;
                try { line = await reader.ReadLineAsync(cts.Token); }
                catch (OperationCanceledException) { break; }

                if (line is null) break;
                if (line.StartsWith(": ")) continue;    // heartbeat / comment
                if (line.StartsWith("event: "))
                {
                    pendingEventName = line[7..];
                    continue;
                }
                if (line.StartsWith("data: "))
                {
                    receivedEventName = pendingEventName;
                    received.TrySetResult(JsonSerializer.Deserialize<JsonElement>(line[6..]));
                    break;
                }
            }
        }, cts.Token);

        // Allow the broadcaster's LISTEN connection to attach.
        await Task.Delay(2000, cts.Token);

        // POST a component event — triggers NOTIFY component_events → broadcaster → SSE.
        await PostEventAsync("live-test-driver", eventType: "status");

        var ev = await received.Task.WaitAsync(cts.Token);

        // Event name must be "component" (§11 component-events stream spec).
        Assert.Equal("component", receivedEventName);

        // Data payload must carry the ComponentEventRecord snake_case fields.
        Assert.Equal("live-test-driver", ev.GetProperty("component_id").GetString());
        Assert.Equal("status", ev.GetProperty("event_type").GetString());
        Assert.Equal("running", ev.GetProperty("state").GetString());
        Assert.True(ev.TryGetProperty("id", out _), "Frame must include 'id' field.");
        Assert.True(ev.TryGetProperty("occurred_at", out _), "Frame must include 'occurred_at'.");
        Assert.True(ev.TryGetProperty("received_at", out _), "Frame must include 'received_at'.");

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }
    }
}
