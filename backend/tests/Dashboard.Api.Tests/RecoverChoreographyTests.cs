using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for the recover choreography (issue #423) — the non-destructive
/// counterpart of <see cref="ResetChoreographyTests"/>, which this file mirrors structurally.
/// Covers: 202/409 (including cross-operation mutual exclusion with reset); since/days_back
/// resolution + the 202 body's echoed `since`; recover-initiated → recover-started →
/// recover-completed SSE fan-out with the resolved `since` carried in every frame's `payload`;
/// the 422 since-XOR-days_back validation; and non-destructiveness (deployment_events +
/// fetcher_state survive a full recover cycle, unlike reset's D14 clear).
/// Runs against the shared Postgres container (via <see cref="PostgresFixture"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class RecoverChoreographyTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public RecoverChoreographyTests(PostgresFixture fixture) => _fixture = fixture;

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
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private HttpRequestMessage RecoverRequest(object? body) =>
        new(HttpMethod.Post, "/api/control/recover")
        {
            Content = JsonContent.Create(body),
            Headers = { { "X-Control-API-Key", TestApiFactory.TestControlApiKey } },
        };

    private HttpRequestMessage RecoverSinceDaysBack(int daysBack) =>
        RecoverRequest(new { days_back = daysBack });

    private HttpRequestMessage ResetRequest() =>
        new(HttpMethod.Post, "/api/control/reset")
        {
            Headers = { { "X-Control-API-Key", TestApiFactory.TestControlApiKey } },
        };

    private HttpRequestMessage ControlStreamRequest(string? lastEventId = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/control/stream");
        req.Headers.Add("X-Control-API-Key", TestApiFactory.TestControlApiKey);
        if (lastEventId is not null)
            req.Headers.Add("Last-Event-ID", lastEventId);
        return req;
    }

    private static HttpRequestMessage IngestRequest() =>
        new(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(new
            {
                deployment_id = $"gh-{Guid.NewGuid():N}",
                service = "recover-test-svc",
                environment = "prod",
                status = "success",
                happened_at = "2026-05-31T10:00:00Z",
            }),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };

    private HttpRequestMessage RecoverAckRequest(string componentId, string correlationId) =>
        new(HttpMethod.Post, "/api/control/events")
        {
            Content = JsonContent.Create(new
            {
                event_type = "recover-ack",
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

    // ── 202 / body shape ─────────────────────────────────────────────────────

    [Fact]
    public async Task Post_Recover_WithDaysBack_Returns202WithCorrelationIdDrainingStateAndResolvedSince()
    {
        var beforeAccept = DateTimeOffset.UtcNow;
        var res = await _client.SendAsync(RecoverSinceDaysBack(3));

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("draining", body.GetProperty("state").GetString());
        Assert.NotEqual(Guid.Empty, Guid.Parse(body.GetProperty("correlation_id").GetString()!));
        Assert.True(body.TryGetProperty("accepted_at", out _));

        // days_back=3 resolves to since = now - 3 days; assert it lands within a small window.
        var since = body.GetProperty("since").GetDateTimeOffset();
        var expected = beforeAccept.AddDays(-3);
        Assert.True(Math.Abs((since - expected).TotalSeconds) < 10,
            $"resolved since ({since:o}) should be ~3 days before accept time ({expected:o})");
    }

    [Fact]
    public async Task Post_Recover_WithAbsoluteSince_EchoesTheSuppliedSinceVerbatim()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var res = await _client.SendAsync(RecoverRequest(new { since = since.ToString("o") }));

        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(since, body.GetProperty("since").GetDateTimeOffset());
    }

    // ── 409: mutual exclusion (recover vs recover, AND recover vs reset) ──────

    [Fact]
    public async Task Post_Recover_WhileAlreadyInFlight_Returns409()
    {
        var first = await _client.SendAsync(RecoverSinceDaysBack(1));
        Assert.Equal(HttpStatusCode.Accepted, first.StatusCode);
        var firstBody = await first.Content.ReadFromJsonAsync<JsonElement>();
        var correlationId = Guid.Parse(firstBody.GetProperty("correlation_id").GetString()!);

        // Deterministically observe our own claim on the shared reset_cycle row (id=1) before
        // racing the conflicting second request. Without this, a neighboring test's fire-and-forget
        // orchestrator (RecoverService/ResetService's `_ = Task.Run(...)`) can still be alive
        // against the same Postgres container after its own WebApplicationFactory was disposed,
        // occasionally flipping the row back to idle in the gap between these two requests and
        // making the 409 assertion flaky. This does not change recover/409 semantics — it only
        // closes the race window by confirming the in-flight state actually landed first.
        await AssertCycleClaimedAsync(correlationId, "draining", TimeSpan.FromSeconds(2));

        var second = await _client.SendAsync(RecoverSinceDaysBack(1));
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Equal("application/problem+json", second.Content.Headers.ContentType?.MediaType);
    }

    /// <summary>
    /// Polls <c>reset_cycle</c> (id=1) directly until its <c>state</c>/<c>correlation_id</c> match
    /// the just-accepted operation, or <paramref name="timeout"/> elapses. Fails with a diagnostic
    /// message (not a silent pass-through) if the claim never lands as expected — surfacing stale
    /// cross-test orchestrator contamination distinctly from a genuine 409-semantics regression.
    /// </summary>
    private async Task AssertCycleClaimedAsync(Guid expectedCorrelationId, string expectedState, TimeSpan timeout)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        var deadline = DateTimeOffset.UtcNow + timeout;
        ResetCycle? cycle;
        do
        {
            cycle = await db.ResetCycles.AsNoTracking().SingleOrDefaultAsync(c => c.Id == 1);
            if (cycle is not null && cycle.CorrelationId == expectedCorrelationId && cycle.State == expectedState)
                return;

            await Task.Delay(25);
        } while (DateTimeOffset.UtcNow < deadline);

        Assert.Fail(
            $"reset_cycle row did not deterministically reach state='{expectedState}' with " +
            $"correlation_id={expectedCorrelationId} within {timeout}; observed " +
            $"state='{cycle?.State}', correlation_id={cycle?.CorrelationId} " +
            "(likely stale cross-test orchestrator contamination on the shared row).");
    }

    [Fact]
    public async Task Post_Recover_WhileResetInFlight_Returns409()
    {
        var resetRes = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Accepted, resetRes.StatusCode);

        var recoverRes = await _client.SendAsync(RecoverSinceDaysBack(1));
        Assert.Equal(HttpStatusCode.Conflict, recoverRes.StatusCode);
    }

    [Fact]
    public async Task Post_Reset_WhileRecoverInFlight_Returns409()
    {
        var recoverRes = await _client.SendAsync(RecoverSinceDaysBack(1));
        Assert.Equal(HttpStatusCode.Accepted, recoverRes.StatusCode);

        var resetRes = await _client.SendAsync(ResetRequest());
        Assert.Equal(HttpStatusCode.Conflict, resetRes.StatusCode);
    }

    // ── 422: since XOR days_back ──────────────────────────────────────────────

    [Fact]
    public async Task Post_Recover_BothSinceAndDaysBack_Returns422()
    {
        var res = await _client.SendAsync(RecoverRequest(new
        {
            since = DateTimeOffset.UtcNow.ToString("o"),
            days_back = 1,
        }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Post_Recover_NeitherSinceNorDaysBack_Returns422()
    {
        var res = await _client.SendAsync(RecoverRequest(new { }));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    [Fact]
    public async Task Post_Recover_DaysBackZero_Returns422()
    {
        var res = await _client.SendAsync(RecoverSinceDaysBack(0));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    [Fact]
    public async Task Post_Recover_UnknownField_Returns422()
    {
        // D5: unknown write fields are rejected — RecoverRequest is [JsonUnmappedMemberHandling.Disallow].
        var res = await _client.SendAsync(RecoverRequest(new { days_back = 1, bogus_field = "x" }));
        Assert.Equal(HttpStatusCode.UnprocessableEntity, res.StatusCode);
    }

    // ── SSE: recover-initiated → recover-started → recover-completed, since in payload ──

    [Fact]
    public async Task FullCycle_EmitsRecoverPhaseEventsInOrder_WithSincePayloadOnEachFrame()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);

        await Task.Delay(1500, cts.Token);

        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var recoverRes = await _client.SendAsync(RecoverRequest(new { since = since.ToString("o") }), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, recoverRes.StatusCode);
        var recoverBody = await recoverRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = recoverBody.GetProperty("correlation_id").GetString()!;

        var ack1 = await _client.SendAsync(RecoverAckRequest("dashboard-fetcher", correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack1.StatusCode);
        var ack2 = await _client.SendAsync(RecoverAckRequest("demo-driver", correlationId), cts.Token);
        Assert.Equal(HttpStatusCode.NoContent, ack2.StatusCode);

        var frames = await ReadDataFramesAsync(stream, 3, cts.Token);
        var types = frames.Select(f => f.GetProperty("type").GetString()).ToList();
        Assert.Contains("recover-initiated", types);
        Assert.Contains("recover-started", types);
        Assert.Contains("recover-completed", types);

        var initiated = frames.First(f => f.GetProperty("type").GetString() == "recover-initiated");
        Assert.Equal(correlationId, initiated.GetProperty("id").GetString());
        Assert.Equal(correlationId, initiated.GetProperty("correlation_id").GetString());
        Assert.Equal("*", initiated.GetProperty("component").GetString());

        var started = frames.First(f => f.GetProperty("type").GetString() == "recover-started");
        Assert.Equal(correlationId, started.GetProperty("correlation_id").GetString());

        var completed = frames.First(f => f.GetProperty("type").GetString() == "recover-completed");
        Assert.Equal(correlationId, completed.GetProperty("correlation_id").GetString());

        // The resolved `since` must be carried in the `payload` of the completed frame
        // (recover-initiated/started may or may not carry it per the saga design — the
        // resolved point is guaranteed on recover-completed, the frame components react to).
        Assert.True(completed.TryGetProperty("payload", out var payload),
            "recover-completed must carry a payload.");
        Assert.Equal(since, payload.GetProperty("since").GetDateTimeOffset());
    }

    // ── Non-destructive: deployment_events + fetcher_state survive a full cycle ──

    [Fact]
    public async Task FullCycle_DoesNotClearDeploymentEventsOrFetcherState()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));

        var ingestBefore = await _client.SendAsync(IngestRequest(), cts.Token);
        Assert.Equal(HttpStatusCode.Created, ingestBefore.StatusCode);

        var fetcherReq = new HttpRequestMessage(HttpMethod.Put, "/api/fetcher/state/recover-test-adapter")
        {
            Content = JsonContent.Create(new { cursor = "test-cursor" }),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };
        await _client.SendAsync(fetcherReq, cts.Token);

        using var streamRes = await _client.SendAsync(
            ControlStreamRequest(), HttpCompletionOption.ResponseHeadersRead, cts.Token);
        await using var stream = await streamRes.Content.ReadAsStreamAsync(cts.Token);
        await Task.Delay(1000, cts.Token);

        var recoverRes = await _client.SendAsync(RecoverSinceDaysBack(1), cts.Token);
        Assert.Equal(HttpStatusCode.Accepted, recoverRes.StatusCode);
        var recoverBody = await recoverRes.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: cts.Token);
        var correlationId = recoverBody.GetProperty("correlation_id").GetString()!;

        await _client.SendAsync(RecoverAckRequest("dashboard-fetcher", correlationId), cts.Token);
        await _client.SendAsync(RecoverAckRequest("demo-driver", correlationId), cts.Token);

        var frames = await ReadDataFramesAsync(stream, 3, cts.Token);
        Assert.Contains(frames, f => f.GetProperty("type").GetString() == "recover-completed");

        // Unlike reset (D14: deployment_events + fetcher_state cleared), recover clears
        // NOTHING — both must still be present after the cycle completes.
        var depPage = await _client.GetFromJsonAsync<JsonElement>(
            "/api/deployments?service=recover-test-svc", cts.Token);
        Assert.True(depPage.GetProperty("items").GetArrayLength() >= 1);

        var fetcherGet = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/recover-test-adapter");
        fetcherGet.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var fetcherRes = await _client.SendAsync(fetcherGet, cts.Token);
        Assert.Equal(HttpStatusCode.OK, fetcherRes.StatusCode);
    }

    // ── 401 auth (mirrors reset's least-privilege gate) ───────────────────────

    [Fact]
    public async Task Post_Recover_NoControlKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/recover")
        {
            Content = JsonContent.Create(new { days_back = 1 }),
        };
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Post_Recover_ApiKeyInsteadOfControlKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/control/recover")
        {
            Content = JsonContent.Create(new { days_back = 1 }),
            Headers = { { "X-Control-API-Key", TestApiFactory.TestApiKey } },
        };
        var res = await _client.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}

/// <summary>
/// Integration tests for the reconciler's operation-matched orphan recovery (Fix A,
/// generalized for #423) when the orphaned cycle is a RECOVER, not a reset — mirrors
/// <c>IngestGateTests.Reconciler_OrphanedPastDeadlineCycle_IsAbortedWithinReconcilerInterval</c>
/// in <c>ResetChoreographyTests.cs</c>. The SQLite-only unit coverage for the emission logic
/// itself lives in <c>Dashboard.Control.Tests/RecoverOrchestratorTimeoutTests.cs</c>
/// (<c>ReconcilerOrphanEmission_*</c>, via reflection); this asserts the real
/// <c>pg_try_advisory_lock</c>-gated reconciler background service picks up an orphaned
/// recover row end-to-end against real Postgres.
/// </summary>
[Collection("api-postgres")]
public sealed class RecoverReconcilerIntegrationTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public RecoverReconcilerIntegrationTests(PostgresFixture fixture) => _fixture = fixture;

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

    [Fact]
    public async Task Reconciler_OrphanedPastDeadlineRecoverCycle_IsAbortedAndEmitsRecoverCompleted()
    {
        // Seed an orphaned recover cycle (operation="recover", recover_since set) with a
        // deadline that is already past — simulates a crashed driving instance.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Dashboard.Shared.Data.DashboardDbContext>();

        var recoverSince = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var cycle = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(cycle);
        cycle.State = "resetting";
        // "reset" and "recover" share the state column values (idle/draining/resetting);
        // "operation" is the discriminator the reconciler reads to decide which *-completed
        // to emit (internal Dashboard.Control.Repositories.ControlOperation.Recover = "recover").
        cycle.Operation = "recover";
        cycle.CorrelationId = Guid.CreateVersion7();
        cycle.RecoverSince = recoverSince;
        cycle.StartedAt = DateTimeOffset.UtcNow.AddSeconds(-120);
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(-60);
        await db.SaveChangesAsync();

        // Wait for at least one reconciler tick (interval = 5 s).
        await Task.Delay(TimeSpan.FromSeconds(8));

        db.ChangeTracker.Clear();
        var reloaded = await db.ResetCycles.FindAsync((short)1);
        Assert.NotNull(reloaded);
        Assert.Equal("idle", reloaded.State);
        Assert.Null(reloaded.CorrelationId);
        // Abort resets the discriminator back to the seeded baseline.
        Assert.Equal("reset", reloaded.Operation);
        Assert.Null(reloaded.RecoverSince);
    }
}
