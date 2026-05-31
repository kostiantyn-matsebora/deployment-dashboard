using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <c>GET /api/control/stream</c>:
/// auth, <c>Last-Event-ID</c> replay from <c>control_stream_events</c>, the <c>?component=</c>
/// filter (matches the id or <c>"*"</c>), and live reset fan-out via LISTEN/NOTIFY.
/// Runs against a real Postgres container (Testcontainers).
/// </summary>
public sealed class ControlStreamTests : IAsyncLifetime
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

    /// <summary>Seeds one persisted control-stream row directly via a DI scope.</summary>
    private async Task<Guid> SeedAsync(string component, string type = "reset")
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var id = Guid.CreateVersion7();
        db.ControlStreamEvents.Add(new ControlStreamEvent
        {
            Id = id,
            Type = type,
            Component = component,
            OccurredAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return id;
    }

    private HttpRequestMessage StreamRequest(string query = "", string? lastEventId = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, $"/api/control/stream{query}");
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        if (lastEventId is not null) req.Headers.Add("Last-Event-ID", lastEventId);
        return req;
    }

    /// <summary>Reads SSE <c>data:</c> frames and returns the parsed JSON payloads.</summary>
    private static async Task<List<JsonElement>> ReadDataFramesAsync(Stream stream, int count, CancellationToken ct)
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

    // ── Auth ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Stream_NoControlKey_Returns401()
    {
        var res = await _client.GetAsync("/api/control/stream", HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Stream_ValidControlKey_Returns200EventStream()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var res = await _client.SendAsync(
            StreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/event-stream", res.Content.Headers.ContentType?.MediaType);
    }

    // ── Last-Event-ID replay ────────────────────────────────────────────────────

    [Fact]
    public async Task Stream_Replay_ReturnsEventsSinceLastEventId()
    {
        var id1 = await SeedAsync("*");
        var id2 = await SeedAsync("*");
        var id3 = await SeedAsync("*");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await _client.SendAsync(
            StreamRequest(lastEventId: id1.ToString()),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var frames = await ReadDataFramesAsync(stream, count: 2, cts.Token);
        var ids = frames.Select(f => f.GetProperty("id").GetString()).ToList();

        Assert.Equal(2, ids.Count);
        Assert.Contains(id2.ToString(), ids);
        Assert.Contains(id3.ToString(), ids);
        Assert.DoesNotContain(id1.ToString(), ids);
    }

    [Fact]
    public async Task Stream_Replay_ComponentFilter_MatchesIdOrWildcard()
    {
        var wildcard = await SeedAsync("*");
        var teamA = await SeedAsync("team-a");
        var teamB = await SeedAsync("team-b");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var res = await _client.SendAsync(
            StreamRequest(query: "?component=team-a", lastEventId: Guid.Empty.ToString()),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var frames = await ReadDataFramesAsync(stream, count: 2, cts.Token);
        var ids = frames.Select(f => f.GetProperty("id").GetString()).ToList();

        // "*" (applies to all) and "team-a" delivered; "team-b" excluded.
        Assert.Contains(wildcard.ToString(), ids);
        Assert.Contains(teamA.ToString(), ids);
        Assert.DoesNotContain(teamB.ToString(), ids);
    }

    [Fact]
    public async Task Stream_Replay_EmptyWhenNothingAfterCursor()
    {
        var lastId = await SeedAsync("*");

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var res = await _client.SendAsync(
            StreamRequest(lastEventId: lastId.ToString()),
            HttpCompletionOption.ResponseHeadersRead, cts.Token);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        var frames = await ReadDataFramesAsync(stream, count: 1, cts.Token);

        Assert.Empty(frames);
    }

    // ── Live reset fan-out (LISTEN/NOTIFY) ───────────────────────────────────────

    [Fact]
    public async Task Stream_LiveReset_ReceivesResetEvent()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        using var res = await _client.SendAsync(
            StreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        await using var stream = await res.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        var received = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        var readTask = Task.Run(async () =>
        {
            while (!cts.IsCancellationRequested)
            {
                string? line;
                try { line = await reader.ReadLineAsync(cts.Token); }
                catch (OperationCanceledException) { break; }

                if (line is null) break;
                if (!line.StartsWith("data: ")) continue;

                received.TrySetResult(JsonSerializer.Deserialize<JsonElement>(line[6..]));
                break;
            }
        }, cts.Token);

        // Allow the SSE subscription to register and the broadcaster LISTEN to attach.
        await Task.Delay(2000, cts.Token);

        // Trigger a reset → NOTIFY control_events → broadcaster → SSE fan-out.
        var resetReq = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        resetReq.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        var resetRes = await _client.SendAsync(resetReq, cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, resetRes.StatusCode);

        var ev = await received.Task.WaitAsync(cts.Token);
        Assert.Equal("reset", ev.GetProperty("type").GetString());
        Assert.Equal("*", ev.GetProperty("component").GetString());

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }
    }
}
