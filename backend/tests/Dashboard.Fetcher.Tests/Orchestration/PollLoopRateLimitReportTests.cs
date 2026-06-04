using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Dashboard.Fetcher.Tests.Orchestration;

/// <summary>
/// F18 / §5.11 — per-cycle rate-limit report emitted by <see cref="PollLoop"/>.
/// <list type="bullet">
///   <item>Report fires once per successful cycle when snapshot is non-null.</item>
///   <item>Report is SKIPPED when snapshot is null.</item>
///   <item>A report failure does NOT break the loop — loop continues next cycle.</item>
/// </list>
/// No real network — all dependencies are NSubstitute mocks.
/// </summary>
public sealed class PollLoopRateLimitReportTests
{
    // ── Per-cycle emit fires once per successful cycle ───────────────────────

    [Fact]
    public async Task ReportCycleAsync_InvokedOncePerSuccessfulCycle_WhenSnapshotPresent()
    {
        var adapter = MakeAdapter("github-actions");
        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        var reportCallCount = 0;
        Func<RateLimitSnapshot, CancellationToken, Task> report = (_, _) =>
        {
            reportCallCount++;
            return Task.CompletedTask;
        };

        var snapshot = new RateLimitSnapshot(Used: 10, Budget: 100, ResetAt: DateTimeOffset.UtcNow.AddHours(1));

        // Run for exactly 1 cycle (large poll interval) then cancel.
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var loop = new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromSeconds(30),
            NullLogger<PollLoop>.Instance,
            rateLimitSnapshotFactory: () => snapshot,
            reportCycleAsync: report);

        await loop.RunAsync(cts.Token);

        Assert.Equal(1, reportCallCount);
    }

    // ── Snapshot null → report skipped ───────────────────────────────────────

    [Fact]
    public async Task ReportCycleAsync_NotInvoked_WhenSnapshotNull()
    {
        var adapter = MakeAdapter("github-actions");
        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        var reportCallCount = 0;
        Func<RateLimitSnapshot, CancellationToken, Task> report = (_, _) =>
        {
            reportCallCount++;
            return Task.CompletedTask;
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var loop = new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromSeconds(30),
            NullLogger<PollLoop>.Instance,
            rateLimitSnapshotFactory: () => null,   // always null — no snapshot
            reportCycleAsync: report);

        await loop.RunAsync(cts.Token);

        Assert.Equal(0, reportCallCount);
    }

    // ── Report failure does not break the loop ───────────────────────────────

    [Fact]
    public async Task ReportCycleAsync_Failure_DoesNotBreakLoop()
    {
        var adapter = MakeAdapter("github-actions");
        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        var successfulCycleCount = 0;
        var adapter_callCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                adapter_callCount++;
                return EmptyChunks();
            });

        var snapshot = new RateLimitSnapshot(Used: 5, Budget: 100, ResetAt: DateTimeOffset.UtcNow.AddHours(1));

        Func<RateLimitSnapshot, CancellationToken, Task> alwaysFailReport = (_, _) =>
            throw new HttpRequestException("POST /api/control/events failed");

        // Track readiness to count successful cycles
        var readiness = Substitute.For<IFetcherReadinessIndicator>();
        readiness.When(r => r.RecordSuccess(Arg.Any<RateLimitSnapshot?>()))
            .Do(_ => successfulCycleCount++);

        // Run for long enough to complete 2 cycles (poll interval = 10ms, timeout = 150ms).
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        var loop = new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(10),
            NullLogger<PollLoop>.Instance,
            readiness: readiness,
            rateLimitSnapshotFactory: () => snapshot,
            reportCycleAsync: alwaysFailReport);

        await loop.RunAsync(cts.Token);

        // Loop ran multiple cycles despite the report throwing each time.
        Assert.True(successfulCycleCount >= 2,
            $"Loop should have completed at least 2 cycles; actual={successfulCycleCount}");
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static ICiCdAdapter MakeAdapter(string adapterId)
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns(adapterId);
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(EmptyChunks());
        return adapter;
    }

    private static async IAsyncEnumerable<FetchResult> EmptyChunks()
    {
        yield return new FetchResult([], null);
        await Task.CompletedTask;
    }
}
