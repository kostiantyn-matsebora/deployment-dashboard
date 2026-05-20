using System.Net;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Hosting;
using Dashboard.Fetcher.Tests.Support;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// CR-0009 + ADR-0004 — coverage for the host scheduler / dispatch loop in
/// <see cref="FetcherWorker"/>. The HTTP layer is faked through the same
/// <see cref="StubHttpHandler"/> the adapter tests use; the adapter itself
/// is replaced by an in-process <see cref="StubCiCdAdapter"/> so each test
/// can dictate exactly what the worker observes from the upstream tool.
///
/// <para>The worker is invoked via <c>StartAsync</c>/<c>StopAsync</c> so we
/// drive exactly one cycle without the <see cref="PeriodicTimer"/> firing
/// twice mid-test.</para>
/// </summary>
public sealed class FetcherWorkerTests
{
    private const string WriteApiBase = "http://write-api.test/";
    private const string ProgressReporter = "dashboard-fetcher/test-adapter";
    private const string SourceId = "acme/svc";
    private const string AdapterId = "test-adapter";

    // ──────────────────────────────────────────────────────────────────────
    // 9. Cursor IS advanced when every push succeeds
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_FullPageSuccess_CallsPutCursor_WithNewWatermark()
    {
        var handler = new StubHttpHandler();
        // GET cursor → 404 (no prior state). Worker treats as null cursor.
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);
        // POST /api/deployments — every push returns 201.
        handler.WhenStatus(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            HttpStatusCode.Created);
        // PUT cursor — expected exactly once with the adapter's new cursor.
        handler.WhenStatus(req => req.Method == HttpMethod.Put && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.OK);

        var adapter = new StubCiCdAdapter();
        adapter.EnqueuePage(new FetchPage(
            new[] { Evt("a"), Evt("b"), Evt("c") },
            NewCursor: "watermark-3",
            HasMore: false));

        await RunOneCycleAsync(handler, adapter);

        // Three POST /api/deployments + one PUT cursor advance.
        var posts = handler.Requests.Where(r => r.Method == HttpMethod.Post).ToList();
        Assert.Equal(3, posts.Count);
        Assert.All(posts, p => Assert.Equal(ProgressReporter, p.Headers["X-Progress-Reporter"]));

        var put = handler.Requests.Single(r => r.Method == HttpMethod.Put);
        Assert.Contains("\"cursor\":\"watermark-3\"", put.Body, StringComparison.Ordinal);
        Assert.Equal(ProgressReporter, put.Headers["X-Progress-Reporter"]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 10. Cursor NOT advanced on partial-page failure
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_PartialPageFailure_NeverCallsPutCursor()
    {
        var handler = new StubHttpHandler();
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);

        // First two POSTs succeed, the third returns 500 (transient backend
        // failure that bubbles up to the worker).
        handler.EnqueueOnce(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            () => new HttpResponseMessage(HttpStatusCode.Created));
        handler.EnqueueOnce(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            () => new HttpResponseMessage(HttpStatusCode.Created));
        handler.EnqueueOnce(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            () => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        // No PUT matcher — if the worker tried to PUT the cursor, the stub
        // would throw and fail the test loudly.

        var adapter = new StubCiCdAdapter();
        adapter.EnqueuePage(new FetchPage(
            new[] { Evt("a"), Evt("b"), Evt("c") },
            NewCursor: "watermark-3",
            HasMore: false));

        await RunOneCycleAsync(handler, adapter);

        // Push attempts stop on the failure (worker breaks out of the loop).
        var posts = handler.Requests.Where(r => r.Method == HttpMethod.Post).ToList();
        Assert.Equal(3, posts.Count);

        var puts = handler.Requests.Where(r => r.Method == HttpMethod.Put).ToList();
        Assert.Empty(puts);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 11. POST 409 → treated as success → cursor IS advanced
    //     (BE Deviation 4 — locked in as a test so it can't silently regress)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_PostReturns409_TreatedAsSuccess_CursorAdvances()
    {
        var handler = new StubHttpHandler();
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);

        // First push gets 409 (duplicate — row already there); the other two get 201.
        handler.EnqueueOnce(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            () => new HttpResponseMessage(HttpStatusCode.Conflict));
        handler.WhenStatus(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/deployments"),
            HttpStatusCode.Created);
        handler.WhenStatus(req => req.Method == HttpMethod.Put && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.OK);

        var adapter = new StubCiCdAdapter();
        adapter.EnqueuePage(new FetchPage(
            new[] { Evt("a"), Evt("b"), Evt("c") },
            NewCursor: "watermark-final",
            HasMore: false));

        await RunOneCycleAsync(handler, adapter);

        // Three POST attempts and a single PUT — 409 must not abort the loop.
        Assert.Equal(3, handler.Requests.Count(r => r.Method == HttpMethod.Post));
        var put = handler.Requests.Single(r => r.Method == HttpMethod.Put);
        Assert.Contains("\"cursor\":\"watermark-final\"", put.Body, StringComparison.Ordinal);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 12. Scheduler drift resistance — PeriodicTimer behaviour
    //
    // Pure unit-test of PeriodicTimer semantics: a long awaited tick should
    // not cause a "catch-up burst" of immediate firings when the timer
    // resumes. Issue #25: this used to assert against wall-clock elapsed
    // via Task.Delay + Stopwatch and flaked deterministically on
    // shared-tenant ubuntu-latest GHA runners. It now drives the timer
    // through FakeTimeProvider so the assertion is on logical ticks, not
    // jitter-prone wall-clock samples.
    // ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Drift-resistance contract (issue #25): after a fetch that overruns the
    /// interval, <see cref="PeriodicTimer"/> must NOT queue up the missed
    /// ticks and dump them as rapid back-to-back signals on subsequent
    /// <c>WaitForNextTickAsync</c> calls.
    ///
    /// <para>How we assert this deterministically: a
    /// <see cref="FakeTimeProvider"/> drives the timer. After burning the
    /// first tick we <see cref="FakeTimeProvider.Advance"/> the clock by
    /// several intervals in one step (simulating a long fetch overrun),
    /// then call <c>WaitForNextTickAsync</c> repeatedly without advancing
    /// the clock further. Healthy semantics: AT MOST ONE tick is delivered
    /// immediately after the overrun (the single "catch-up" tick);
    /// subsequent calls remain pending until the clock advances past the
    /// next interval boundary. Regressed/queueing semantics: every backed-up
    /// tick fires immediately and the second <c>WaitForNextTickAsync</c>
    /// returns without any further <c>Advance</c>.</para>
    ///
    /// <para>No wall-clock samples; no <c>Task.Delay</c>; jitter-immune.</para>
    /// </summary>
    [Fact]
    public async Task PeriodicTimer_LongTickDoesNotCauseBackToBackBurstOfTicks()
    {
        var interval = TimeSpan.FromMilliseconds(200);
        var longFetch = TimeSpan.FromMilliseconds(700); // ~3 intervals of overrun
        var fakeTime = new FakeTimeProvider(DateTimeOffset.UtcNow);

        using var timer = new PeriodicTimer(interval, fakeTime);

        // Burn the first tick: advance one interval, await completion.
        var firstTick = timer.WaitForNextTickAsync();
        fakeTime.Advance(interval);
        Assert.True(await firstTick);

        // Simulate a long fetch: advance the clock past several interval
        // boundaries in one step. PeriodicTimer must collapse this to a
        // single "owed" tick — not three queued back-to-back ticks.
        fakeTime.Advance(longFetch);

        // First post-overrun WaitForNextTickAsync: returns the one owed
        // catch-up tick immediately (clock is already past the boundary).
        Assert.True(await timer.WaitForNextTickAsync());

        // Second post-overrun WaitForNextTickAsync: drift-resistance
        // contract — this must NOT return without further clock advance.
        // If PeriodicTimer were queueing missed ticks, the ValueTask would
        // already be completed (the bug we're guarding against). We probe
        // the pending state by Task.WhenAny against a yielded marker.
        var pendingTick = timer.WaitForNextTickAsync().AsTask();
        Assert.False(pendingTick.IsCompleted,
            "PeriodicTimer queued a back-to-back catch-up tick after the long fetch overrun. " +
            "Drift-resistance contract requires at most ONE owed tick per overrun.");

        // Confirm normal forward-progress still works: a single interval
        // advance must complete the pending tick.
        fakeTime.Advance(interval);
        Assert.True(await pendingTick);

        // And one more cycle for good measure — each tick requires its own
        // full interval, no residual catch-up state.
        var thirdTick = timer.WaitForNextTickAsync().AsTask();
        Assert.False(thirdTick.IsCompleted);
        fakeTime.Advance(interval);
        Assert.True(await thirdTick);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 13. First-fetch path on 404 — adapter sees `cursor: null` + pageSize == INITIAL_FETCH_LIMIT (50)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_FirstFetch_404OnGetCursor_AdapterReceivesNullCursorAndDefaultPageSize()
    {
        var handler = new StubHttpHandler();
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);
        // No POSTs needed — empty page; no PUT either (cursor unchanged).
        var adapter = new StubCiCdAdapter();
        adapter.EnqueuePage(new FetchPage(Array.Empty<DeploymentEventRequest>(), NewCursor: "0", HasMore: false));

        await RunOneCycleAsync(handler, adapter);

        Assert.Single(adapter.Calls);
        var call = adapter.Calls[0];
        Assert.Null(call.Cursor);
        Assert.Equal(50, call.PageSize); // INITIAL_FETCH_LIMIT default
        Assert.Equal(SourceId, call.SourceId);
    }

    [Fact]
    public async Task RunOneCycle_ReadsExistingCursor_FromWriteApi_BeforeFetching()
    {
        var handler = new StubHttpHandler();
        handler.WhenJson(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.OK,
            "{\"progress_reporter\":\"" + ProgressReporter + "\",\"source_id\":\"" + SourceId +
            "\",\"cursor\":\"prior-99\",\"updated_at\":\"2026-05-18T09:00:00Z\"}");
        var adapter = new StubCiCdAdapter();
        adapter.EnqueuePage(new FetchPage(Array.Empty<DeploymentEventRequest>(), NewCursor: "prior-99", HasMore: false));

        await RunOneCycleAsync(handler, adapter);

        var call = Assert.Single(adapter.Calls);
        Assert.Equal("prior-99", call.Cursor);
    }

    // ──────────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────────

    private static DeploymentEventRequest Evt(string suffix) => new()
    {
        DeploymentId = $"gha-{suffix}",
        Service = "svc",
        Environment = "dev",
        Version = "v1",
        Status = DeploymentStatus.Success,
        RunUrl = "https://example.com/r/1",
        RunNumber = 1,
        Actor = "system",
    };

    /// <summary>
    /// Run exactly one poll cycle: start the worker (it kicks off the first
    /// cycle immediately per FetcherWorker's <c>do/while</c> loop), then stop
    /// it before the timer fires a second time.
    /// </summary>
    private static async Task RunOneCycleAsync(StubHttpHandler handler, StubCiCdAdapter adapter)
    {
        var factory = new StubHttpClientFactory();
        factory.Register(FetcherStateClient.HttpClientName, handler, WriteApiBase);

        var stateClient = new FetcherStateClient(factory, NullLogger<FetcherStateClient>.Instance);

        var options = new FetcherOptions
        {
            WriteApiUrl = WriteApiBase,
            WriteApiKey = "test-key",
            PollIntervalSeconds = 5,            // worker min-clamps; we Stop() before the second tick anyway
            InitialFetchLimit = 50,
            AdapterIds = new[] { AdapterId },
            ProgressReporterOverride = ProgressReporter,
            SourceIdsByAdapter = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
            {
                [AdapterId] = new[] { SourceId },
            },
        };

        var worker = new FetcherWorker(
            options,
            new ICiCdAdapter[] { adapter },
            stateClient,
            NullLogger<FetcherWorker>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await worker.StartAsync(cts.Token);

        // Wait for the adapter to be invoked at least once. The first cycle
        // runs synchronously inside ExecuteAsync; busy-wait briefly so the
        // task scheduler can run our background thread.
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (adapter.Calls.Count == 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(15, cts.Token);
        }

        await worker.StopAsync(cts.Token);
    }

    /// <summary>
    /// Test-only adapter. Each <see cref="FetchPageAsync"/> call dequeues the
    /// next pre-registered page; calls are captured for assertion.
    /// </summary>
    private sealed class StubCiCdAdapter : ICiCdAdapter
    {
        private readonly Queue<FetchPage> _pages = new();
        public List<(string SourceId, string? Cursor, int PageSize)> Calls { get; } = new();

        public string AdapterId => "test-adapter";

        public void EnqueuePage(FetchPage page) => _pages.Enqueue(page);

        public Task<FetchPage> FetchPageAsync(string sourceId, string? cursor, int pageSize, CancellationToken ct)
        {
            Calls.Add((sourceId, cursor, pageSize));
            // If a test only enqueues one page but HasMore=true, return an
            // empty no-op page on the second call so the loop terminates.
            var page = _pages.Count > 0
                ? _pages.Dequeue()
                : new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
            return Task.FromResult(page);
        }
    }
}
