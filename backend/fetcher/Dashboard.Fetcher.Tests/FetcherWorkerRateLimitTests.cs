using System.Net;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Hosting;
using Dashboard.Fetcher.Tests.Support;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// CR-0011 acceptance criterion (a) cap reached → stop / (c) reset
/// elapsed → resume without cursor advance / (f) one INFO log line per
/// window. Extends the <see cref="FetcherWorkerTests"/> pattern (one cycle
/// via <c>StartAsync</c>/<c>StopAsync</c>; HTTP layer faked via
/// <see cref="StubHttpHandler"/>; adapter replaced by an in-process stub
/// returning a controlled <see cref="FetchPage"/>).
///
/// <para>The host's contract per ADR-0008 Decision 1 + CR-0011 § 3a:</para>
/// <list type="number">
///   <item>When the most-recent <see cref="RateLimitObservation"/> has
///   <c>upstream_used ≥ self_imposed_cap</c> AND <c>now &lt; upstream_reset_at</c>,
///   the worker SKIPS the next CI/CD API call for that
///   <c>(adapter, source-id)</c> AND does NOT advance the cursor.</item>
///   <item>When the cap is reached the worker emits a single INFO-level
///   log line per window (NOT per skipped request).</item>
///   <item>The worker STILL pushes a usage snapshot to
///   <c>POST /api/fetcher/usage</c> on the cap-reached tick — the
///   snapshot then reflects the cap-reached state, so the dashboard
///   shows red even while the fetcher is paused.</item>
/// </list>
///
/// <para><strong>Pending dependency.</strong> When this file lands ahead of
/// the BE's leaky-bucket-gate integration in <see cref="FetcherWorker"/>
/// + the per-tick usage push, every test below FAILS — that is the
/// expected Phase 5 → Phase 6 routing per <c>core/process.md § 5</c>.</para>
/// </summary>
public sealed class FetcherWorkerRateLimitTests
{
    private const string WriteApiBase = "http://write-api.test/";
    private const string ProgressReporter = "dashboard-fetcher/test-adapter";
    private const string SourceId = "acme/svc";
    private const string AdapterId = "test-adapter";

    // ──────────────────────────────────────────────────────────────────────
    // 1. Cap reached → no cursor advance, no POST /api/deployments
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_CapReached_DoesNotIssueDeploymentPosts_AndDoesNotAdvanceCursor()
    {
        var handler = new StubHttpHandler();
        // GET cursor → existing watermark.
        handler.WhenJson(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.OK,
            "{\"progress_reporter\":\"" + ProgressReporter + "\",\"source_id\":\"" + SourceId +
            "\",\"cursor\":\"prior-99\",\"updated_at\":\"2026-05-21T09:00:00Z\"}");
        // POST /api/fetcher/usage — accept any (cap-reached tick still pushes).
        handler.WhenStatus(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/fetcher/usage"),
            HttpStatusCode.OK);
        // NO POST /api/deployments matcher — if the worker tries to push an
        // event on a cap-reached tick, the stub throws and the test fails loudly.
        // NO PUT /api/fetcher/state matcher — same reason for the cursor path.

        var adapter = new SeedingCiCdAdapter(
            // Adapter primed with the "cap reached" observation so the gate
            // skips the next FetchPageAsync call. The seed call (the cycle's
            // first observation) supplies the gate input.
            primingPage: new FetchPage(
                Events: Array.Empty<DeploymentEventRequest>(),
                NewCursor: "prior-99",
                HasMore: false,
                RateLimit: new RateLimitObservation(
                    UpstreamLimit: 5000,
                    UpstreamRemaining: 0,                        // used == cap
                    UpstreamResetAt: DateTime.UtcNow.AddMinutes(30),
                    ObservedAt: DateTime.UtcNow.AddSeconds(-5))));

        await RunOneCycleAsync(handler, adapter, capPercentage: 1); // 1% of 5000 = 50; used=5000 >> 50

        // No /api/deployments POST.
        var deploymentPosts = handler.Requests.Where(r =>
            r.Method == HttpMethod.Post && r.Uri.AbsolutePath.EndsWith("/api/deployments")).ToList();
        Assert.Empty(deploymentPosts);

        // No PUT cursor.
        var cursorPuts = handler.Requests.Where(r => r.Method == HttpMethod.Put).ToList();
        Assert.Empty(cursorPuts);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2. Cap reached → INFO log line emitted ONCE per window (NOT per request)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_CapReached_EmitsExactlyOneInfoLogLine_PerWindow()
    {
        var handler = new StubHttpHandler();
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);
        handler.WhenStatus(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/fetcher/usage"),
            HttpStatusCode.OK);

        var adapter = new SeedingCiCdAdapter(
            primingPage: new FetchPage(
                Events: Array.Empty<DeploymentEventRequest>(),
                NewCursor: "0",
                HasMore: false,
                RateLimit: new RateLimitObservation(
                    UpstreamLimit: 5000,
                    UpstreamRemaining: 0,
                    UpstreamResetAt: DateTime.UtcNow.AddMinutes(30),
                    ObservedAt: DateTime.UtcNow.AddSeconds(-5))));

        var logger = new RecordingLogger<FetcherWorker>();
        await RunOneCycleAsync(handler, adapter, capPercentage: 1, logger: logger);

        // Exactly one INFO log line mentioning "cap" (the cap-reached message).
        // The wording is mockable but must contain the word "cap" so an
        // operator grep finds it. Multiple INFO log lines on a single
        // cap-reached cycle would violate § 3a "Log a single INFO line per
        // window (not per request) to keep log volume bounded".
        var capInfoLines = logger.Records
            .Where(r => r.Level == LogLevel.Information &&
                        (r.Message.Contains("cap", StringComparison.OrdinalIgnoreCase) ||
                         r.Message.Contains("rate", StringComparison.OrdinalIgnoreCase)))
            .ToList();

        Assert.Single(capInfoLines);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 3. Cap reached → STILL pushes usage snapshot (reflects cap-reached state)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task RunOneCycle_CapReached_StillPushesUsageSnapshot_ReflectingCapState()
    {
        var handler = new StubHttpHandler();
        handler.WhenStatus(req => req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/api/fetcher/state/"),
            HttpStatusCode.NotFound);
        handler.WhenStatus(req => req.Method == HttpMethod.Post && req.RequestUri!.AbsolutePath.EndsWith("/api/fetcher/usage"),
            HttpStatusCode.OK);

        var adapter = new SeedingCiCdAdapter(
            primingPage: new FetchPage(
                Events: Array.Empty<DeploymentEventRequest>(),
                NewCursor: "0",
                HasMore: false,
                RateLimit: new RateLimitObservation(
                    UpstreamLimit: 5000,
                    UpstreamRemaining: 100,                       // used = 4900
                    UpstreamResetAt: DateTime.UtcNow.AddMinutes(20),
                    ObservedAt: DateTime.UtcNow.AddSeconds(-5))));

        await RunOneCycleAsync(handler, adapter, capPercentage: 30); // 1500 cap; used=4900 >> 1500

        // Exactly one POST /api/fetcher/usage with the cap-reached snapshot.
        var usagePosts = handler.Requests.Where(r =>
            r.Method == HttpMethod.Post && r.Uri.AbsolutePath.EndsWith("/api/fetcher/usage")).ToList();
        Assert.Single(usagePosts);

        var body = usagePosts[0].Body ?? string.Empty;
        // Wire field assertions (snake_case per CR-0011 § 3b). We assert on
        // substrings rather than parsing JSON to keep the test isolated from
        // serializer-option drift; the values are the load-bearing contract.
        Assert.Contains("\"adapter_id\":\"" + AdapterId + "\"", body, StringComparison.Ordinal);
        Assert.Contains("\"source_id\":\"" + SourceId + "\"", body, StringComparison.Ordinal);
        Assert.Contains("\"upstream_limit\":5000", body, StringComparison.Ordinal);
        Assert.Contains("\"upstream_remaining\":100", body, StringComparison.Ordinal);
        Assert.Contains("\"upstream_used\":4900", body, StringComparison.Ordinal);
        Assert.Contains("\"self_imposed_cap\":1500", body, StringComparison.Ordinal);
        // Required header per CR-0011 § 3b (matches the fetcher-state endpoints).
        Assert.Equal(ProgressReporter, usagePosts[0].Headers["X-Progress-Reporter"]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────────

    private static async Task RunOneCycleAsync(
        StubHttpHandler handler,
        SeedingCiCdAdapter adapter,
        int capPercentage,
        ILogger<FetcherWorker>? logger = null)
    {
        var factory = new StubHttpClientFactory();
        factory.Register(FetcherStateClient.HttpClientName, handler, WriteApiBase);

        var stateClient = new FetcherStateClient(factory, NullLogger<FetcherStateClient>.Instance);

        var options = new FetcherOptions
        {
            WriteApiUrl = WriteApiBase,
            WriteApiKey = "test-key",
            PollIntervalSeconds = 5,
            InitialFetchLimit = 50,
            AdapterIds = new[] { AdapterId },
            ProgressReporterOverride = ProgressReporter,
            SourceIdsByAdapter = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
            {
                [AdapterId] = new[] { SourceId },
            },
            RateLimitPercentage = capPercentage,
        };

        var worker = new FetcherWorker(
            options,
            new ICiCdAdapter[] { adapter },
            stateClient,
            logger ?? NullLogger<FetcherWorker>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await worker.StartAsync(cts.Token);

        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(5);
        while (adapter.Calls.Count == 0 && DateTime.UtcNow < deadline)
        {
            await Task.Delay(15, cts.Token);
        }

        await worker.StopAsync(cts.Token);
    }

    /// <summary>
    /// Test-only adapter whose first <c>FetchPageAsync</c> call returns the
    /// "priming" page so the worker captures the rate-limit observation,
    /// and subsequent calls return an empty no-op page. Used by tests that
    /// need the worker to see a cap-reached observation BEFORE the gate is
    /// consulted.
    /// </summary>
    private sealed class SeedingCiCdAdapter : ICiCdAdapter
    {
        private readonly FetchPage _primingPage;
        public List<(string SourceId, string? Cursor, int PageSize)> Calls { get; } = new();
        private int _calls;

        public string AdapterId => "test-adapter";

        public SeedingCiCdAdapter(FetchPage primingPage)
        {
            _primingPage = primingPage;
        }

        public Task<FetchPage> FetchPageAsync(string sourceId, string? cursor, int pageSize, CancellationToken ct)
        {
            Calls.Add((sourceId, cursor, pageSize));
            var i = Interlocked.Increment(ref _calls);
            if (i == 1)
            {
                return Task.FromResult(_primingPage);
            }
            return Task.FromResult(new FetchPage(
                Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false));
        }
    }

    /// <summary>
    /// Minimal capture-logger so the "one INFO line per window" assertion
    /// can introspect emitted log records. Production uses
    /// <see cref="ILogger{FetcherWorker}"/> structured logging.
    /// </summary>
    private sealed class RecordingLogger<T> : ILogger<T>
    {
        public List<LogRecord> Records { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
            => Records.Add(new LogRecord(logLevel, formatter(state, exception)));

        public sealed record LogRecord(LogLevel Level, string Message);
    }
}
