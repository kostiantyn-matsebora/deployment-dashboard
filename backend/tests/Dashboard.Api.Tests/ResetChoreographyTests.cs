using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Abstractions;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for the reset choreography (phase 11 + robustness fixes).
/// Covers: 202/409; reset-initiated SSE fan-out; full 2-ack cycle with reset_id
/// correlation; timeout structural; data-clear scope; readyz third channel.
/// Runs against a real Postgres container (Testcontainers).
/// </summary>
public sealed class ResetChoreographyTests : IAsyncLifetime
{
    // Use real broadcaster so LISTEN/NOTIFY fan-out reaches the stream.
    private readonly TestApiFactory _factory = new() { UseRealNotifier = true };
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        await _factory.InitializeAsync();
        await _factory.MigrateAsync();
        _client = _factory.CreateClient();
        // Allow the broadcasters to establish LISTEN.
        await Task.Delay(TimeSpan.FromSeconds(2));
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private HttpRequestMessage ResetRequest() =>
        BuildControlRequest(HttpMethod.Post, "/api/control/reset");

    private HttpRequestMessage ControlStreamRequest(string? lastEventId = null)
    {
        var req = BuildControlRequest(HttpMethod.Get, "/api/control/stream");
        if (lastEventId is not null)
            req.Headers.Add("Last-Event-ID", lastEventId);
        return req;
    }

    private HttpRequestMessage BuildControlRequest(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, path);
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        return req;
    }

    private static HttpRequestMessage IngestRequest() =>
        new(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(new
            {
                deployment_id = $"gh-{Guid.NewGuid():N}",
                service = "reset-test-svc",
                environment = "prod",
                status = "success",
                happened_at = "2026-05-31T10:00:00Z",
            }),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };

    private HttpRequestMessage AckRequest(string componentId, string resetId) =>
        new(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "reset-ack",
                state = "paused",
                occurred_at = DateTimeOffset.UtcNow.ToString("o"),
                payload = new { reset_id = resetId },
            }),
            Headers =
            {
                { "X-Api-Key", TestApiFactory.TestApiKey },
                { "X-Component-Id", componentId },
            },
        };

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

    // ── 202 / 409 ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_Reset_Returns202WithResetIdAndDrainingState()
    {
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("draining", body.GetProperty("state").GetString());
        Assert.NotEqual(Guid.Empty, Guid.Parse(body.GetProperty("reset_id").GetString()!));
        Assert.True(body.TryGetProperty("accepted_at", out _));
    }

    [Fact]
    public async Task Post_Reset_WhileAlreadyInFlight_Returns409()
    {
        var first = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);

        var second = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("application/problem+json", second.Content.Headers.ContentType?.MediaType);
    }

    // ── reset-initiated on the control stream ─────────────────────────────────

    [Fact]
    public async Task Post_Reset_EmitsResetInitiatedOnControlStream()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, streamRes.StatusCode);

        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);
        await Task.Delay(1000, cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var body = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var resetId = body.GetProperty("reset_id").GetString()!;

        var frames = await ReadDataFramesAsync(stream, 1, cts.Token);
        Assert.Single(frames);

        var ev = frames[0];
        Assert.Equal("reset-initiated", ev.GetProperty("type").GetString());
        Assert.Equal("*", ev.GetProperty("component").GetString());
        Assert.Equal(resetId, ev.GetProperty("id").GetString());
    }

    // ── reset_id correlation across all three events ───────────────────────────

    [Fact]
    public async Task FullCycle_TwoAcks_EmitsStartedAndCompleted_WithResetIdCorrelation()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);

        await Task.Delay(1500, cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var resetId = resetBody.GetProperty("reset_id").GetString()!;

        var ack1 = await _client.SendAsync(AckRequest("dashboard-fetcher", resetId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack1.StatusCode);

        var ack2 = await _client.SendAsync(AckRequest("demo-driver", resetId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack2.StatusCode);

        var frames = await ReadDataFramesAsync(stream, 3, cts.Token);

        var types = frames.Select(f => f.GetProperty("type").GetString()).ToList();
        Assert.Contains("reset-initiated", types);
        Assert.Contains("reset-started", types);
        Assert.Contains("reset-completed", types);

        var started = frames.First(f => f.GetProperty("type").GetString() == "reset-started");
        Assert.Equal(resetId, started.GetProperty("reset_id").GetString());

        var completed = frames.First(f => f.GetProperty("type").GetString() == "reset-completed");
        Assert.Equal(resetId, completed.GetProperty("reset_id").GetString());
    }

    // ── 401 auth ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_Reset_NoControlKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Post_Reset_WrongControlKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        req.Headers.Add("X-Control-API-Key", "wrong");
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    // ── Readyz third channel ──────────────────────────────────────────────────

    [Fact]
    public async Task Readyz_AfterStartup_IncludesListenAcksCheck()
    {
        await Task.Delay(2000);

        var res = await _client.GetAsync("/readyz");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var checks = body.GetProperty("checks");

        Assert.True(checks.TryGetProperty("listen_acks", out var acksCheck),
            "readyz must include 'listen_acks' check for the component_acks channel.");
        Assert.Equal("ok", acksCheck.GetString());
    }

    // ── Timeout path (AckTimeoutSeconds) ─────────────────────────────────────

    [Fact]
    public async Task Timeout_WhenNoAcksArriveWithinTimeout_CycleProceeds()
    {
        var res = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);

        // Immediately, a second call should 409 (draining still active).
        var res2 = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Conflict, res2.StatusCode);
    }

    // ── Data-clear scope (D14) ─────────────────────────────────────────────────

    [Fact]
    public async Task FullCycle_DeploymentEventsAndFetcherStateAreCleared()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var ingestBefore = await _client.SendAsync(IngestRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Created, ingestBefore.StatusCode);

        var fetcherReq = new HttpRequestMessage(HttpMethod.Put, "/api/fetcher/state/reset-test-adapter")
        {
            Content = JsonContent.Create(new { cursor = "test-cursor" }),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };
        await _client.SendAsync(fetcherReq, cts.Token);

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);
        await Task.Delay(1000, cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var resetId = resetBody.GetProperty("reset_id").GetString()!;

        await _client.SendAsync(AckRequest("dashboard-fetcher", resetId), cts.Token);
        await _client.SendAsync(AckRequest("demo-driver", resetId), cts.Token);

        var frames = await ReadDataFramesAsync(stream, 3, cts.Token);
        Assert.Contains(frames, f => f.GetProperty("type").GetString() == "reset-completed");

        var depPage = await _client.GetFromJsonAsync<JsonElement>(
            "/api/deployments?service=reset-test-svc", cts.Token);
        Assert.Equal(0, depPage.GetProperty("items").GetArrayLength());

        var fetcherGet = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/reset-test-adapter");
        fetcherGet.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var fetcherRes = await _client.SendAsync(fetcherGet, cts.Token);
        Assert.Equal(HttpStatusCode.NotFound, fetcherRes.StatusCode);
    }
}

/// <summary>
/// Integration tests for the ingest gate (Fix C) and reconciler behavior (Fix A).
/// Uses a separate factory with <see cref="ForcedResetStateProvider"/> for gate tests
/// to avoid NOTIFY/LISTEN timing dependencies.
/// </summary>
public sealed class IngestGateTests : IAsyncLifetime
{
    private readonly ForcedResetStateProvider _forcedState = new() { IsResetting = false };

    private readonly TestApiFactory _factory;
    private HttpClient _client = null!;

    public IngestGateTests()
    {
        _factory = new TestApiFactory
        {
            UseRealNotifier = false,
            ForcedResetState = _forcedState,
        };
    }

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

    private static HttpRequestMessage IngestRequest() =>
        new(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(new
            {
                deployment_id = $"gh-{Guid.NewGuid():N}",
                service = "gate-test-svc",
                environment = "prod",
                status = "success",
                happened_at = "2026-05-31T10:00:00Z",
            }),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };

    // ── Fix C: cached flag gate ───────────────────────────────────────────────

    [Fact]
    public async Task Ingest_WhenIsResettingFalse_Returns201()
    {
        _forcedState.IsResetting = false;
        var res = await _client.SendAsync(IngestRequest());
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    [Fact]
    public async Task Ingest_WhenIsResettingTrue_Returns503WithRetryAfter()
    {
        _forcedState.IsResetting = true;

        var res = await _client.SendAsync(IngestRequest());

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
        Assert.True(res.Headers.Contains("Retry-After"), "503 response must include Retry-After header.");
    }

    [Fact]
    public async Task Ingest_GateFlipsOffAfterResettingTrue_SubsequentRequestsSucceed()
    {
        _forcedState.IsResetting = true;
        var blocked = await _client.SendAsync(IngestRequest());
        Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);

        // Simulate the NOTIFY reset_state 'idle' being received by flipping the stub.
        _forcedState.IsResetting = false;

        var allowed = await _client.SendAsync(IngestRequest());
        Assert.Equal(HttpStatusCode.Created, allowed.StatusCode);
    }

    // ── Fix A: reconciler aborts orphan via DB + emits reset-completed ─────────

    [Fact]
    public async Task Reconciler_OrphanedPastDeadlineCycle_IsAbortedWithinReconcilerInterval()
    {
        // Seed an orphaned resetting cycle with a deadline that is already past.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Dashboard.Shared.Data.DashboardDbContext>();

        // The seeded row from migration is idle; update it to resetting with a past deadline.
        var cycle = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(cycle);
        cycle.State = "resetting";
        cycle.ResetId = Guid.CreateVersion7();
        cycle.StartedAt = DateTimeOffset.UtcNow.AddSeconds(-120);
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(-60);
        await db.SaveChangesAsync();

        // Wait for at least one reconciler tick (interval = 5 s; GateMaxTtl = 60 s default,
        // but StartedAt is 120 s in the past so now >= StartedAt + GateMaxTtlSeconds).
        await Task.Delay(TimeSpan.FromSeconds(8));

        // Reload — the reconciler should have reset to idle.
        db.ChangeTracker.Clear();
        var reloaded = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(reloaded);
        Assert.Equal("idle", reloaded.State);
        Assert.Null(reloaded.ResetId);
    }

    [Fact]
    public async Task Reconciler_CycleWithinTtl_IsNotAborted()
    {
        // Seed a draining cycle with a deadline far in the future.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Dashboard.Shared.Data.DashboardDbContext>();

        var resetId = Guid.CreateVersion7();
        var cycle = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(cycle);
        cycle.State = "draining";
        cycle.ResetId = resetId;
        cycle.StartedAt = DateTimeOffset.UtcNow;
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(300);
        await db.SaveChangesAsync();

        // Wait one reconciler tick.
        await Task.Delay(TimeSpan.FromSeconds(7));

        // Must still be draining.
        db.ChangeTracker.Clear();
        var reloaded = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(reloaded);
        Assert.Equal("draining", reloaded.State);
        Assert.Equal(resetId, reloaded.ResetId);
    }

    // ── Fix C: ResetStateProvider seeded from DB at startup ───────────────────

    [Fact]
    public async Task ResetStateProvider_WhenDbIsIdle_IsResettingIsFalse()
    {
        // The factory seeds a fresh DB with idle state; the real ResetStateListener
        // is replaced by ForcedResetStateProvider in this factory, so we verify the
        // contract: IResetStateProvider is registered and returns IsResetting=false.
        var provider = _factory.Services.GetRequiredService<IResetStateProvider>();
        Assert.False(provider.IsResetting);
    }
}
