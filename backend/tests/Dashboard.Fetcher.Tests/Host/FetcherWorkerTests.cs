using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Dashboard.Fetcher.Tests.Host;

/// <summary>
/// Unit tests for <see cref="FetcherWorker"/> (§3).
/// FetcherWorker runs all registered PollLoops concurrently and stops on cancellation.
/// </summary>
public sealed class FetcherWorkerTests
{
    // ── Helpers ──────────────────────────────────────────────────────────────

    private static async IAsyncEnumerable<FetchResult> EmptyChunks()
    {
        yield return new FetchResult([], null);
        await Task.CompletedTask;
    }

    private static PollLoop MakePollLoop(string adapterId = "github-actions", TimeSpan pollInterval = default)
    {
        if (pollInterval == default)
            pollInterval = TimeSpan.FromHours(1);

        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns(adapterId);
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
               .Returns(EmptyChunks());

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns((string?)null);

        return new PollLoop(
            adapter, ingest, state,
            pollInterval,
            NullLogger<PollLoop>.Instance);
    }

    // ── All poll loops are started ────────────────────────────────────────────

    [Fact]
    public async Task ExecuteAsync_StartsAllRegisteredPollLoops()
    {
        // Track which adapters are polled to confirm both loops run.
        var polledAdapters = new List<string>();

        ICiCdAdapter MakeTrackingAdapter(string id)
        {
            var adapter = Substitute.For<ICiCdAdapter>();
            adapter.AdapterId.Returns(id);
            adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
                   .Returns(_ =>
                   {
                       lock (polledAdapters) polledAdapters.Add(id);
                       return EmptyChunks();
                   });
            return adapter;
        }

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns((string?)null);

        var loop1 = new PollLoop(MakeTrackingAdapter("adapter-1"), ingest, state,
            TimeSpan.FromMilliseconds(10), NullLogger<PollLoop>.Instance);
        var loop2 = new PollLoop(MakeTrackingAdapter("adapter-2"), ingest, state,
            TimeSpan.FromMilliseconds(10), NullLogger<PollLoop>.Instance);

        var worker = new FetcherWorker([loop1, loop2]);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        await worker.StartAsync(cts.Token);
        await Task.Delay(150, CancellationToken.None);
        cts.Cancel();
        try { await worker.StopAsync(CancellationToken.None); } catch { /* expected on cancel */ }

        // Both adapters must have been polled at least once.
        Assert.Contains("adapter-1", polledAdapters);
        Assert.Contains("adapter-2", polledAdapters);
    }

    // ── Empty poll-loop list completes without error ──────────────────────────

    [Fact]
    public async Task ExecuteAsync_NoPollLoops_CompletesWithoutError()
    {
        var worker = new FetcherWorker([]);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await worker.StartAsync(cts.Token);

        // With no loops, Task.WhenAll([]) completes immediately — the worker should stop cleanly.
        await Task.Delay(50, CancellationToken.None);
        cts.Cancel();
        await worker.StopAsync(CancellationToken.None);
    }

    // ── Single poll loop runs and stops on cancellation ───────────────────────

    [Fact]
    public async Task ExecuteAsync_SingleLoop_StopsOnCancellation()
    {
        var loop = MakePollLoop("github-actions", TimeSpan.FromMilliseconds(20));
        var worker = new FetcherWorker([loop]);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        await worker.StartAsync(cts.Token);
        await Task.Delay(80, CancellationToken.None);
        cts.Cancel();

        // StopAsync should complete without throwing after cancellation.
        await worker.StopAsync(CancellationToken.None);
    }

    // ── Poll loops run concurrently — both start before either completes ──────

    [Fact]
    public async Task ExecuteAsync_LoopsRunConcurrently_BothAdaptersPolledBeforeTimeout()
    {
        // With a small poll interval both loops should be executing at the same time,
        // evidenced by polledAdapters containing both ids before the short deadline.
        var polledAdapters = new HashSet<string>();
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        ICiCdAdapter MakeGatedAdapter(string id)
        {
            var adapter = Substitute.For<ICiCdAdapter>();
            adapter.AdapterId.Returns(id);
            adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
                   .Returns(_ =>
                   {
                       lock (polledAdapters)
                       {
                           polledAdapters.Add(id);
                           if (polledAdapters.Count == 2)
                               gate.TrySetResult();
                       }
                       return EmptyChunks();
                   });
            return adapter;
        }

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns((string?)null);

        var loop1 = new PollLoop(MakeGatedAdapter("concurrent-1"), ingest, state,
            TimeSpan.FromMilliseconds(5), NullLogger<PollLoop>.Instance);
        var loop2 = new PollLoop(MakeGatedAdapter("concurrent-2"), ingest, state,
            TimeSpan.FromMilliseconds(5), NullLogger<PollLoop>.Instance);

        var worker = new FetcherWorker([loop1, loop2]);

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await worker.StartAsync(cts.Token);

        // Gate signals when both have been polled at least once.
        await gate.Task.WaitAsync(TimeSpan.FromSeconds(3));
        cts.Cancel();
        try { await worker.StopAsync(CancellationToken.None); } catch { /* expected */ }

        Assert.Equal(2, polledAdapters.Count);
    }
}
