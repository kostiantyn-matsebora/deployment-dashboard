using System.Net;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Hosting;
using Dashboard.Fetcher.Tests.Support;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Microsoft.Extensions.Logging.Abstractions;

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
    // resumes. We assert against the BCL primitive that FetcherWorker uses
    // rather than spinning up the worker on a 1s interval and waiting
    // (avoids a multi-second sleep in the suite). This is the cheapest
    // possible confirmation that the underlying primitive does what
    // ExecuteAsync depends on; manual operator-side verification is the
    // fallback if behaviour ever diverges across .NET versions.
    // ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Drift-resistance contract: after a fetch that overruns the interval,
    /// PeriodicTimer must NOT queue up the missed ticks and dump them as
    /// rapid back-to-back signals on subsequent WaitForNextTickAsync calls.
    ///
    /// <para>What we measure: the wall-clock time to drain N consecutive
    /// ticks after a long simulated fetch. If the BCL were queueing missed
    /// ticks, draining N consecutive ticks would take roughly zero time;
    /// a healthy PeriodicTimer takes ~N intervals to drain N ticks because
    /// each call waits for the next interval boundary.</para>
    ///
    /// <para>The exact constants are jitter-tolerant: a regression where
    /// PeriodicTimer queued the missed ticks would surface as a near-zero
    /// total drain time (~10-20ms across 3 ticks). A healthy implementation
    /// takes at least 2 intervals (~400ms) across 3 ticks because at most
    /// one tick is "ready immediately" after the long await, and each
    /// subsequent tick waits a full interval.</para>
    /// </summary>
    [Fact]
    public async Task PeriodicTimer_LongTickDoesNotCauseBackToBackBurstOfTicks()
    {
        const int IntervalMs = 200;
        const int LongFetchMs = 700;            // ~3 intervals of overrun
        const int TicksToDrain = 3;

        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(IntervalMs));

        Assert.True(await timer.WaitForNextTickAsync());           // burn the first tick

        // Simulate a long fetch — multiple tick boundaries pass while we sleep.
        await Task.Delay(LongFetchMs);

        // Drain N consecutive ticks and measure total wall-clock time.
        var sw = System.Diagnostics.Stopwatch.StartNew();
        for (var i = 0; i < TicksToDrain; i++)
        {
            Assert.True(await timer.WaitForNextTickAsync());
        }
        sw.Stop();

        // Three consecutive ticks on a 200ms timer SHOULD take at least 2
        // intervals (~400ms). If PeriodicTimer were queueing missed ticks,
        // this loop would complete in ~10-20ms (the BCL would dump all
        // backlogged ticks immediately). The 250ms floor below is the burst
        // regression line — well above any realistic queue-drain time, well
        // below the healthy ~400ms+ measurement.
        Assert.True(sw.ElapsedMilliseconds >= 250,
            $"Drained {TicksToDrain} consecutive ticks in {sw.ElapsedMilliseconds}ms — " +
            "PeriodicTimer is queueing missed ticks (drift-resistance broken). " +
            "Healthy behaviour: drain time scales with interval × ticks; broken behaviour: near-zero.");
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
