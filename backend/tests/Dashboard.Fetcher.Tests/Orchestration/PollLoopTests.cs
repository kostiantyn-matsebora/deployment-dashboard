using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace Dashboard.Fetcher.Tests.Orchestration;

public sealed class PollLoopTests
{
    private static DeploymentEventIngest MakeEvent() => new()
    {
        DeploymentId = "gh-deploy-1",
        Service = "api",
        Environment = "prod",
        Status = DeploymentStatus.Success,
        HappenedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task PollLoop_PostsEventsAndAdvancesCursor()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var cursor1 = "cursor-1";
        var cursor2 = "cursor-2";
        var ev = MakeEvent();

        adapter.FetchAsync(null, Arg.Any<CancellationToken>())
            .Returns(new FetchResult([ev], cursor1));
        adapter.FetchAsync(cursor1, Arg.Any<CancellationToken>())
            .Returns(new FetchResult([], cursor1));

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync("github-actions", Arg.Any<CancellationToken>())
            .Returns((string?)null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(10),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        await ingest.Received(1).PostAsync(ev, "github-actions", Arg.Any<CancellationToken>());
        await state.Received(1).PutAsync("github-actions", cursor1, Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PollLoop_MidBatchFailure_CursorNotAdvanced()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var ev1 = MakeEvent();
        var ev2 = MakeEvent();
        adapter.FetchAsync(null, Arg.Any<CancellationToken>())
            .Returns(new FetchResult([ev1, ev2], "new-cursor"));

        var ingest = Substitute.For<IIngestClient>();
        // First POST succeeds, second throws
        ingest.PostAsync(ev1, Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.CompletedTask);
        ingest.PostAsync(ev2, Arg.Any<string>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("POST failed"));

        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns((string?)null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(200),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        // Cursor must NOT have been persisted
        await state.DidNotReceive().PutAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PollLoop_NoEvents_CursorNotPersisted()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(new FetchResult([], "same-cursor"));

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns("same-cursor");

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(10),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        await state.DidNotReceive().PutAsync(
            Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task PollLoop_AdapterThrows_LoopContinues()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var callCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                callCount++;
                if (callCount == 1) throw new Exception("transient error");
                return Task.FromResult(new FetchResult([], null));
            });

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(150));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(20),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        Assert.True(callCount >= 2, "Loop should have retried after error");
    }
}
