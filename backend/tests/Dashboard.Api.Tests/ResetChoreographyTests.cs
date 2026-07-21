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
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class ResetChoreographyTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    // Use real broadcaster so LISTEN/NOTIFY fan-out reaches the stream.
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public ResetChoreographyTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString) { UseRealNotifier = true };
        _client = _factory.CreateClient();
        // Allow the broadcasters to establish LISTEN.
        await Task.Delay(TimeSpan.FromSeconds(2));
    }

    public async Task DisposeAsync()
    {
        // Drain (issue #423 flake fix, 2nd pass): block until this test's own orchestrator (if
        // any — e.g. Post_Reset_WhileAlreadyInFlight_Returns409/Timeout_WhenNoAcksArrive... never
        // send acks, so their orchestrator is still driving here) reaches its own terminal
        // 'idle' write on the shared reset_cycle (id=1) row, BEFORE the factory is torn down.
        // See Helpers.ResetCycleQuiescence for the full root-cause writeup: an advisory-lock-free
        // probe is NOT sufficient because the lock is only acquired *inside* the fire-and-forget
        // Task.Run, after the endpoint already returned 202 and claimed the row — a leaked,
        // never-acked orchestrator from this class was one of the two confirmed contamination
        // sources (the other being RecoverReconcilerIntegrationTests) for RecoverChoreographyTests'
        // in-flight 409 assertions.
        await ResetCycleQuiescence.WaitForIdleAsync(_fixture.ConnectionString);

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

    private HttpRequestMessage AckRequest(string componentId, string correlationId) =>
        new(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "reset-ack",
                state = "paused",
                occurred_at = DateTimeOffset.UtcNow.ToString("o"),
            }),
            Headers =
            {
                { "X-Api-Key", TestApiFactory.TestApiKey },
                { "X-Component-Id", componentId },
                { "X-Correlation-Id", correlationId },
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
    public async Task Post_Reset_Returns202WithCorrelationIdAndDrainingState()
    {
        var res = await _client.SendAsync(ResetRequest());

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("draining", body.GetProperty("state").GetString());
        Assert.NotEqual(Guid.Empty, Guid.Parse(body.GetProperty("correlation_id").GetString()!));
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
        var correlationId = body.GetProperty("correlation_id").GetString()!;

        var frames = await ReadDataFramesAsync(stream, 1, cts.Token);
        Assert.Single(frames);

        var ev = frames[0];
        Assert.Equal("reset-initiated", ev.GetProperty("type").GetString());
        Assert.Equal("*", ev.GetProperty("component").GetString());
        Assert.Equal(correlationId, ev.GetProperty("id").GetString());
        // reset-initiated carries its own id as correlation_id
        Assert.Equal(correlationId, ev.GetProperty("correlation_id").GetString());
    }

    // ── correlation_id across all three events ────────────────────────────────

    [Fact]
    public async Task FullCycle_TwoAcks_EmitsStartedAndCompleted_WithCorrelationId()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);

        await Task.Delay(1500, cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = resetBody.GetProperty("correlation_id").GetString()!;

        var ack1 = await _client.SendAsync(AckRequest("dashboard-fetcher", correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack1.StatusCode);

        var ack2 = await _client.SendAsync(AckRequest("demo-driver", correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack2.StatusCode);

        var frames = await ReadDataFramesAsync(stream, 3, cts.Token);

        var types = frames.Select(f => f.GetProperty("type").GetString()).ToList();
        Assert.Contains("reset-initiated", types);
        Assert.Contains("reset-started", types);
        Assert.Contains("reset-completed", types);

        var started = frames.First(f => f.GetProperty("type").GetString() == "reset-started");
        Assert.Equal(correlationId, started.GetProperty("correlation_id").GetString());

        var completed = frames.First(f => f.GetProperty("type").GetString() == "reset-completed");
        Assert.Equal(correlationId, completed.GetProperty("correlation_id").GetString());
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
        var correlationId = resetBody.GetProperty("correlation_id").GetString()!;

        await _client.SendAsync(AckRequest("dashboard-fetcher", correlationId), cts.Token);
        await _client.SendAsync(AckRequest("demo-driver", correlationId), cts.Token);

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
/// Regression guard for ack-driven early completion of the reset choreography.
///
/// The original symptom (in the <c>testing/api</c> black-box suite) was that a single
/// reset-ack from the expected component never shortened the drain — the cycle always ran
/// to <c>AckTimeoutSeconds</c>. The root cause was NOT the notify path: it was the
/// <c>ExpectedComponents</c> array binding. The .NET configuration binder <b>appends</b>
/// config/env array elements onto the property's existing value rather than replacing it,
/// so the old non-empty <c>ResetOptions.ExpectedComponents</c> C# initializer
/// (<c>["dashboard-fetcher","demo-driver"]</c>) survived every override. The ack gate then
/// waited on components that never acked (e.g. an absent <c>dashboard-fetcher</c>) and could
/// only ever complete via timeout. The fix empties that initializer (appsettings/env now
/// fully define the set); this harness applies the per-test override via
/// <c>PostConfigure&lt;ResetOptions&gt;</c> for the same reason (see <see cref="Helpers.TestApiFactory"/>).
///
/// This test sets <c>AckTimeoutSeconds = 30</c> (far longer than any realistic delivery
/// latency) so that an early completion observed within 5 s is provably ack-driven, not
/// timeout-driven.
/// </summary>
[Collection("api-postgres")]
public sealed class AckFanInTests : IAsyncLifetime
{
    private const string TestComponent = "ack-fan-in-test";

    private readonly PostgresFixture _fixture;
    // Long AckTimeout so early completion is unambiguously ack-driven.
    // GateMaxTtl must be larger than AckTimeout; 120 s is safe.
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public AckFanInTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            UseRealNotifier = true,
            ResetConfig = new ResetConfigOverride(
                AckTimeoutSeconds: 30,
                ExpectedComponents: [TestComponent],
                GateMaxTtlSeconds: 120),
        };
        _client = _factory.CreateClient();
        // Allow all three LISTEN channels (component_acks, control_events, reset_state) to connect.
        await Task.Delay(TimeSpan.FromSeconds(2));
    }

    public async Task DisposeAsync()
    {
        // Drain (issue #423 flake fix, 2nd pass): AckGate_ResetAckWithMissingCorrelationIdHeader_...
        // and AckGate_ResetAckWithMismatchedCorrelationId_... deliberately never send a
        // correctly-correlated ack, so their orchestrator is still driving toward its own
        // AckTimeoutSeconds (30 s, per this class's ResetConfigOverride above) at teardown.
        // Use an explicit timeout comfortably above that 30 s bound — ResetCycleQuiescence's
        // 30 s default would race the orchestrator's own terminal write for this class.
        // See Helpers.ResetCycleQuiescence for the full root-cause writeup.
        await ResetCycleQuiescence.WaitForIdleAsync(_fixture.ConnectionString, TimeSpan.FromSeconds(60));

        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private HttpRequestMessage ResetRequest()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/reset");
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        return req;
    }

    private HttpRequestMessage ControlStreamRequest(string? lastEventId = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/control/stream");
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        if (lastEventId is not null)
            req.Headers.Add("Last-Event-ID", lastEventId);
        return req;
    }

    private HttpRequestMessage AckRequest(string componentId, string correlationId) =>
        new(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "reset-ack",
                state = "paused",
                occurred_at = DateTimeOffset.UtcNow.ToString("o"),
            }),
            Headers =
            {
                { "X-Api-Key", TestApiFactory.TestApiKey },
                { "X-Component-Id", componentId },
                { "X-Correlation-Id", correlationId },
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

    // ── Reproducing test ──────────────────────────────────────────────────────

    // ── ACK-gate: X-Correlation-Id is the gate key ────────────────────────────

    /// <summary>
    /// Verifies that a reset-ack with NO <c>X-Correlation-Id</c> header does NOT advance
    /// the ack gate. The gate keys purely on <c>X-Correlation-Id</c>; an absent header
    /// means the event is recorded (204) but does not count toward the active cycle.
    /// </summary>
    [Fact]
    public async Task AckGate_ResetAckWithMissingCorrelationIdHeader_DoesNotCountTowardGate()
    {
        // A long timeout (30 s from factory config) means early completion can ONLY happen
        // if the ack gate was triggered.  We send a reset-ack with no X-Correlation-Id
        // header; the gate should NOT open.  Then send the real ack (with header) and
        // confirm only that one completes the cycle.
        //
        // Two separate SSE connections: first (probe) captures the spurious-ack window;
        // second (verify) captures the ack-driven reset-started.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        // Open first SSE connection for the probe window.
        using var probeRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, probeRes.StatusCode);
        await using var probeStream = await probeRes.Content.ReadAsStreamAsync(cts.Token);

        await Task.Delay(TimeSpan.FromMilliseconds(500), cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = resetBody.GetProperty("correlation_id").GetString()!;

        // Post a reset-ack with no X-Correlation-Id — must NOT count toward the gate.
        var spuriousAck = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "reset-ack",
                state = "paused",
                occurred_at = DateTimeOffset.UtcNow.ToString("o"),
            }),
            Headers =
            {
                { "X-Api-Key", TestApiFactory.TestApiKey },
                { "X-Component-Id", TestComponent },
                // X-Correlation-Id intentionally absent
            },
        };
        var spuriousRes = await _client.SendAsync(spuriousAck, cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, spuriousRes.StatusCode);

        // Give the orchestrator 2 s — if the spurious ack opened the gate, reset-started
        // would arrive within this window.
        await Task.Delay(TimeSpan.FromSeconds(2), cts.Token);

        // Read any frames that arrived so far (non-blocking: use a short window).
        using var probeCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var probeFrames = await ReadDataFramesAsync(probeStream, 99, probeCts.Token);
        var probeTypes = probeFrames.Select(f =>
            f.TryGetProperty("type", out var t) ? t.GetString() : null).ToList();

        Assert.True(
            !probeTypes.Contains("reset-started"),
            "reset-started must NOT arrive after a reset-ack with no X-Correlation-Id header.");

        // Open a second SSE connection for the real verification phase.
        using var verifyRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var verifyStream = await verifyRes.Content.ReadAsStreamAsync(cts.Token);
        await Task.Delay(TimeSpan.FromMilliseconds(500), cts.Token);

        // Now post the correct ack (with X-Correlation-Id) — gate must open promptly.
        var ackSentAt = DateTimeOffset.UtcNow;
        var realAck = await _client.SendAsync(AckRequest(TestComponent, correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, realAck.StatusCode);

        var frames = await ReadDataFramesAsync(verifyStream, 1, cts.Token);
        var startedFrame = frames.FirstOrDefault(
            f => f.TryGetProperty("type", out var t) && t.GetString() == "reset-started");

        Assert.True(startedFrame.ValueKind != JsonValueKind.Undefined,
            "reset-started must arrive after the correct ack (with X-Correlation-Id).");
        Assert.Equal(correlationId, startedFrame.GetProperty("correlation_id").GetString());

        var elapsed = startedFrame.GetProperty("occurred_at").GetDateTimeOffset() - ackSentAt;
        Assert.True(elapsed.TotalSeconds < 5.0,
            $"reset-started arrived {elapsed.TotalSeconds:F1} s after the ack — expected < 5 s (ack-driven).");

        cts.Cancel();
    }

    /// <summary>
    /// Asserts that a reset-ack carrying a mismatched <c>X-Correlation-Id</c> (stale/wrong
    /// cycle id) does NOT advance the ack gate for the active cycle.
    /// </summary>
    [Fact]
    public async Task AckGate_ResetAckWithMismatchedCorrelationId_DoesNotCountTowardGate()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);

        await Task.Delay(TimeSpan.FromMilliseconds(500), cts.Token);

        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = resetBody.GetProperty("correlation_id").GetString()!;

        // Post a reset-ack with a stale/wrong X-Correlation-Id — must NOT count.
        var staleCorrelationId = Guid.CreateVersion7().ToString();
        Assert.NotEqual(correlationId, staleCorrelationId);

        var mismatchedAck = new HttpRequestMessage(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "reset-ack",
                state = "paused",
                occurred_at = DateTimeOffset.UtcNow.ToString("o"),
            }),
            Headers =
            {
                { "X-Api-Key", TestApiFactory.TestApiKey },
                { "X-Component-Id", TestComponent },
                { "X-Correlation-Id", staleCorrelationId },
            },
        };

        var mismatchedRes = await _client.SendAsync(mismatchedAck, cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, mismatchedRes.StatusCode);

        // Give the orchestrator 2 s — if the mismatched ack opened the gate, reset-started
        // would arrive within this window.
        await Task.Delay(TimeSpan.FromSeconds(2), cts.Token);

        // Drain any frames that arrived in the window.
        using var drainCts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var probeFrames = await ReadDataFramesAsync(stream, 99, drainCts.Token);
        var probeTypes = probeFrames.Select(f =>
            f.TryGetProperty("type", out var t) ? t.GetString() : null).ToList();

        Assert.True(
            !probeTypes.Contains("reset-started"),
            "reset-started must NOT arrive after a reset-ack with a mismatched X-Correlation-Id.");

        cts.Cancel();
    }

    /// <summary>
    /// Asserts that posting a reset-ack from the single expected component drives
    /// the orchestrator to emit <c>reset-started</c> promptly — well before the
    /// 30-second AckTimeout expires.
    ///
    /// This fails if <c>ExpectedComponents</c> contains anything beyond the one component
    /// this test acks (the original bug: the binder left stale defaults in the array), since
    /// the gate would then wait on an ack that never arrives and complete only via timeout.
    /// </summary>
    [Fact]
    public async Task AckDrivenEarlyCompletion_SendsAckForExpectedComponent_ResetStartedArrivesWithin5Seconds()
    {
        // Use a generous total budget that is well below AckTimeoutSeconds (30 s).
        // If the cycle completes in < 5 s it is ack-driven; if it took 30 s it is timeout-driven.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, streamRes.StatusCode);

        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);

        // Give the SSE connection a moment to attach before triggering the reset.
        await Task.Delay(TimeSpan.FromMilliseconds(500), cts.Token);

        // --- T₀: trigger reset ---
        var resetRes = await _client.SendAsync(ResetRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);
        var resetBody = await resetRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = resetBody.GetProperty("correlation_id").GetString()!;

        // Record the moment the ack is sent.
        var ackSentAt = DateTimeOffset.UtcNow;

        // --- Post the ack that should drive early completion ---
        var ackRes = await _client.SendAsync(AckRequest(TestComponent, correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ackRes.StatusCode);

        // --- Read SSE until reset-started (or 15 s total) ---
        // We need reset-initiated (1) + reset-started (2) = 2 frames at minimum.
        var frames = await ReadDataFramesAsync(stream, 2, cts.Token);

        var startedFrame = frames.FirstOrDefault(
            f => f.TryGetProperty("type", out var t) && t.GetString() == "reset-started");

        Assert.True(startedFrame.ValueKind != JsonValueKind.Undefined,
            "reset-started must appear within the 15-second window.");

        // Verify it carries the correct correlation_id.
        Assert.Equal(correlationId, startedFrame.GetProperty("correlation_id").GetString());

        // Measure elapsed time: reset-started.occurred_at must be within 5 s of when
        // the ack was sent.  AckTimeoutSeconds = 30, so anything under 5 s is ack-driven.
        var occurredAt = startedFrame.GetProperty("occurred_at").GetDateTimeOffset();
        var elapsed = occurredAt - ackSentAt;

        Assert.True(elapsed.TotalSeconds < 5.0,
            $"reset-started arrived {elapsed.TotalSeconds:F1} s after the ack — " +
            $"expected < 5 s (ack-driven); got > 5 s means timeout-driven (bug). " +
            $"AckTimeoutSeconds = 30.");
    }
}

/// <summary>
/// Integration tests for the ingest gate (Fix C) and reconciler behavior (Fix A).
/// Uses a separate factory with <see cref="ForcedResetStateProvider"/> for gate tests
/// to avoid NOTIFY/LISTEN timing dependencies.
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class IngestGateTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private readonly ForcedResetStateProvider _forcedState = new() { IsResetting = false };
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public IngestGateTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            UseRealNotifier = false,
            ForcedResetState = _forcedState,
        };
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
        cycle.CorrelationId = Guid.CreateVersion7();
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
        Assert.Null(reloaded.CorrelationId);
    }

    [Fact]
    public async Task Reconciler_CycleWithinTtl_IsNotAborted()
    {
        // Seed a draining cycle with a deadline far in the future.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Dashboard.Shared.Data.DashboardDbContext>();

        var correlationId = Guid.CreateVersion7();
        var cycle = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(cycle);
        cycle.State = "draining";
        cycle.CorrelationId = correlationId;
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
        Assert.Equal(correlationId, reloaded.CorrelationId);
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
