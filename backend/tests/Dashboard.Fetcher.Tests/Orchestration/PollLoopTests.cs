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

    // ── helper: build an IAsyncEnumerable<FetchResult> from a params array ────

    private static async IAsyncEnumerable<FetchResult> Chunks(params FetchResult[] results)
    {
        foreach (var r in results)
            yield return r;
        await Task.CompletedTask;
    }

    // ── existing tests adapted to the streaming signature ─────────────────────

    [Fact]
    public async Task PollLoop_PostsEventsAndAdvancesCursor()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var cursor1 = "cursor-1";
        var ev = MakeEvent();

        // First call (cursor null): yields one chunk with one event and advances cursor.
        // Subsequent calls (cursor1): yields one empty chunk (cursor unchanged).
        adapter.FetchAsync(null, Arg.Any<CancellationToken>())
            .Returns(Chunks(new FetchResult([ev], cursor1)));
        adapter.FetchAsync(cursor1, Arg.Any<CancellationToken>())
            .Returns(Chunks(new FetchResult([], cursor1)));

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
            .Returns(Chunks(new FetchResult([ev1, ev2], "new-cursor")));

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
            .Returns(Chunks(new FetchResult([], "same-cursor")));

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
                return Chunks(new FetchResult([], null));
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

    // ── startup cursor-fetch resilience (initial state.GetAsync failure must not fault RunAsync) ──

    /// <summary>
    /// The initial cursor fetch (before the while loop) throws once, then succeeds. The loop
    /// must retry rather than fault, then proceed to poll using the cursor from the successful call.
    /// </summary>
    [Fact]
    public async Task PollLoop_InitialCursorFetchThrowsThenSucceeds_LoopStartsAndPolls()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(Chunks(new FetchResult([], "cursor-1")));

        var ingest = Substitute.For<IIngestClient>();

        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync("github-actions", Arg.Any<CancellationToken>())
            .Returns<string?>(
                _ => throw new HttpRequestException("transient startup failure"),
                _ => null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(20),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        await state.Received(2).GetAsync("github-actions", Arg.Any<CancellationToken>());
        adapter.Received().FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// The initial cursor fetch throws on every attempt; cancellation arrives while still
    /// retrying. RunAsync must complete cleanly (no unobserved fault) rather than propagate
    /// the exception — the zombie-fetcher bug this guards against.
    /// </summary>
    [Fact]
    public async Task PollLoop_InitialCursorFetchPersistentlyThrows_CancellationExitsCleanly()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var ingest = Substitute.For<IIngestClient>();

        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync("github-actions", Arg.Any<CancellationToken>())
            .Returns<string?>(_ => throw new HttpRequestException("persistent startup failure"));

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(60));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(20),
            NullLogger<PollLoop>.Instance);

        // Must not throw: a fault here would reproduce the zombie-fetcher bug.
        await loop.RunAsync(cts.Token);

        adapter.DidNotReceive().FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>());
    }

    // ── new chunked-streaming tests ────────────────────────────────────────────

    /// <summary>
    /// Adapter yields 3 chunks. All events must be posted in order and the cursor
    /// must be persisted after EACH chunk whose cursor differs from the previous.
    /// A large poll interval ensures exactly one cycle runs before cancellation.
    /// </summary>
    [Fact]
    public async Task PollLoop_ThreeChunks_CursorPersistedAfterEachChunk()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var ev1 = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-1",
            Service = "api",
            Environment = "dev",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddHours(-3),
        };
        var ev2 = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-2",
            Service = "api",
            Environment = "staging",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddHours(-2),
        };
        var ev3 = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-3",
            Service = "api",
            Environment = "prod",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddHours(-1),
        };

        var callCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                callCount++;
                // Only the first cycle returns 3 chunks; subsequent calls get empty.
                if (callCount == 1)
                    return Chunks(
                        new FetchResult([ev1], "cursor-1"),
                        new FetchResult([ev2], "cursor-2"),
                        new FetchResult([ev3], "cursor-3"));
                return Chunks(new FetchResult([], "cursor-3"));
            });

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        // Large interval so we don't have many cycles during the 200ms window.
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(500),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        // All 3 distinct events posted exactly once.
        await ingest.Received(1).PostAsync(ev1, "github-actions", Arg.Any<CancellationToken>());
        await ingest.Received(1).PostAsync(ev2, "github-actions", Arg.Any<CancellationToken>());
        await ingest.Received(1).PostAsync(ev3, "github-actions", Arg.Any<CancellationToken>());

        // Cursor persisted 3 times — once per chunk.
        await state.Received(1).PutAsync("github-actions", "cursor-1", Arg.Any<CancellationToken>());
        await state.Received(1).PutAsync("github-actions", "cursor-2", Arg.Any<CancellationToken>());
        await state.Received(1).PutAsync("github-actions", "cursor-3", Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// A zero-event chunk whose cursor differs from the previous IS persisted
    /// (backfill completion markers carry no events but advance the cursor).
    /// </summary>
    [Fact]
    public async Task PollLoop_ZeroEventChunkWithNewCursor_IsPersisted()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var ev = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-1",
            Service = "api",
            Environment = "prod",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow,
        };

        var callCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                callCount++;
                if (callCount == 1)
                    return Chunks(
                        new FetchResult([ev], "cursor-after-events"),
                        new FetchResult([], "cursor-completion-marker"));
                return Chunks(new FetchResult([], "cursor-completion-marker"));
            });

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(500),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        // Both cursors persisted: the event chunk and the completion marker.
        await state.Received(1).PutAsync("github-actions", "cursor-after-events", Arg.Any<CancellationToken>());
        await state.Received(1).PutAsync("github-actions", "cursor-completion-marker", Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// A throw after the second chunk (of three) leaves the cursor at the last successfully
    /// persisted chunk — at-least-once guarantee per chunk (F5).
    /// </summary>
    [Fact]
    public async Task PollLoop_ThrowAfterSecondChunk_CursorAtLastGoodChunk()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        var ev1 = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-1",
            Service = "api",
            Environment = "dev",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddHours(-2),
        };
        var ev2 = new DeploymentEventIngest
        {
            DeploymentId = "gh-deploy-2",
            Service = "api",
            Environment = "staging",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddHours(-1),
        };

        var callCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                callCount++;
                if (callCount == 1) return ThrowingChunks(ev1, ev2);
                // After the throw, cursor stays at cursor-2. Return empty for subsequent calls.
                return Chunks(new FetchResult([], "cursor-2"));
            });

        var ingest = Substitute.For<IIngestClient>();
        ingest.PostAsync(Arg.Any<DeploymentEventIngest>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
            .Returns(Task.CompletedTask);

        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(500),
            NullLogger<PollLoop>.Instance);

        await loop.RunAsync(cts.Token);

        // Cursor-1 and cursor-2 were persisted (first two chunks succeeded before the throw).
        await state.Received(1).PutAsync("github-actions", "cursor-1", Arg.Any<CancellationToken>());
        await state.Received(1).PutAsync("github-actions", "cursor-2", Arg.Any<CancellationToken>());

        // cursor-3 was never yielded (throw happens mid-iteration before cursor-3).
        await state.DidNotReceive().PutAsync("github-actions", "cursor-3", Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// Reset-saga clean-slate step: DropCursorAndResume must reset the adapter's in-memory
    /// fetch state (caches) — not just drop the cursor — so the post-reset backfill re-emits
    /// from scratch rather than reverting to incremental with warm caches (§5.10.5).
    /// </summary>
    [Fact]
    public void DropCursorAndResume_ResetsAdapterState()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();

        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(10),
            NullLogger<PollLoop>.Instance);

        loop.DropCursorAndResume();

        adapter.Received(1).ResetState();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Yields chunk 1 (ev1, cursor-1), chunk 2 (ev2, cursor-2), then throws
    /// mid-iteration to simulate a failure before chunk 3 is yielded.
    /// </summary>
    private static async IAsyncEnumerable<FetchResult> ThrowingChunks(
        DeploymentEventIngest ev1,
        DeploymentEventIngest ev2)
    {
        yield return new FetchResult([ev1], "cursor-1");
        yield return new FetchResult([ev2], "cursor-2");
        await Task.CompletedTask;
        throw new HttpRequestException("adapter error mid-stream");
    }
}
