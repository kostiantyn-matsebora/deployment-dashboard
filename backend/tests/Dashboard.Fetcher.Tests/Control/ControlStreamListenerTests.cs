using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Dashboard.Fetcher.Tests.Control;

/// <summary>
/// Unit tests for F17 §5.10 control-plane participation.
/// All tests use in-memory fakes; no live network.
/// </summary>
public sealed class ControlStreamListenerTests
{
    // ── Helpers ──────────────────────────────────────────────────────────────────

    private static async IAsyncEnumerable<FetchResult> EmptyChunks()
    {
        yield return new FetchResult([], null);
        await Task.CompletedTask;
    }

    private static PollLoop MakePollLoop(
        ICiCdAdapter? adapter = null,
        IIngestClient? ingest = null,
        IFetcherStateClient? state = null)
    {
        adapter ??= Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
               .Returns(EmptyChunks());

        ingest ??= Substitute.For<IIngestClient>();

        state ??= Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns((string?)null);

        return new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromHours(1), // large interval; we control events
            NullLogger<PollLoop>.Instance);
    }

    private static string MakeEventData(
        string id,
        string type,
        string? resetId = null) =>
        JsonSerializer.Serialize(new
        {
            id,
            type,
            reset_id = resetId,
            component = "*",
            occurred_at = DateTimeOffset.UtcNow,
        }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower });

    /// <summary>
    /// Creates a <see cref="IControlStreamClient"/> that yields the given frames then completes.
    /// </summary>
    private static IControlStreamClient MakeStream(params ParsedSseEvent[] frames)
    {
        var client = Substitute.For<IControlStreamClient>();
        client.StreamAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
              .Returns(frames.ToAsyncEnumerable());
        return client;
    }

    /// <summary>
    /// Runs the listener until its stream is exhausted (async-enumerable completes) or the
    /// timeout elapses. After one stream pass the reconnect loop waits 2 s, so we cancel
    /// after a short grace period to avoid waiting the full delay in tests.
    /// </summary>
    private static async Task RunListenerOnceAsync(
        IControlStreamClient stream,
        IComponentEventClient events,
        IReadOnlyList<PollLoop> loops,
        TimeSpan? timeout = null)
    {
        using var cts = new CancellationTokenSource(timeout ?? TimeSpan.FromSeconds(5));
        var listener = new ControlStreamListener(
            stream, events, loops,
            NullLogger<ControlStreamListener>.Instance);

        // ExecuteAsync is the actual long-running method; we invoke it directly so
        // we await its body rather than the fire-and-forget BackgroundService.StartAsync pattern.
        // We cancel after a short idle to stop the reconnect loop from waiting 2 s.
        var task = listener.StartAsync(cts.Token);
        await task; // StartAsync completes synchronously (launches the background task)

        // Give the background task time to drain the in-memory stream.
        await Task.Delay(TimeSpan.FromMilliseconds(200));
        cts.Cancel();
        try { await listener.StopAsync(CancellationToken.None); } catch { /* expected on cancel */ }
    }

    // ── §7.1 reset-initiated: ack posted + loop paused ────────────────────────

    [Fact]
    public async Task ResetInitiated_PausesLoopAndPostsAck()
    {
        var resetId = "01J9F4WZK3W9G2T6X4QH3DKQF6";
        var data = MakeEventData(id: resetId, type: "reset-initiated");

        var loop = MakePollLoop();
        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: resetId, EventType: "reset-initiated", Data: data));

        await RunListenerOnceAsync(stream, events, [loop]);

        Assert.True(loop.IsPaused, "Poll loop must be paused after reset-initiated");
        await events.Received(1).PostAckAsync(resetId, Arg.Any<CancellationToken>());
    }

    // ── §7.1 reset-initiated: reset_id in ack = event id ─────────────────────

    [Fact]
    public async Task ResetInitiated_AckCarriesCorrectResetId()
    {
        var resetId = "01J9CORRECT-RESET-ID-HERE";
        var data = MakeEventData(id: resetId, type: "reset-initiated");

        var loop = MakePollLoop();
        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: resetId, EventType: "reset-initiated", Data: data));

        await RunListenerOnceAsync(stream, events, [loop]);

        // The ack must carry the reset-initiated event's own id as reset_id.
        await events.Received(1).PostAckAsync(
            Arg.Is<string>(r => r == resetId),
            Arg.Any<CancellationToken>());
    }

    // ── §7.1 reset-completed: cursor dropped + backfill triggered + status posted

    [Fact]
    public async Task ResetCompleted_DropsInMemoryCursorAndPostsRunning()
    {
        var resetId = "01J9F4WZK3W9G2T6X4QH3DKQF6";
        var completedId = "01J9F4X1N6B2C3D4E5F6G7H8J9";
        var data = MakeEventData(id: completedId, type: "reset-completed", resetId: resetId);

        // The loop starts paused (simulating a prior reset-initiated).
        var loop = MakePollLoop();
        loop.Pause();

        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: completedId, EventType: "reset-completed", Data: data));

        await RunListenerOnceAsync(stream, events, [loop]);

        Assert.False(loop.IsPaused, "Poll loop must be resumed after reset-completed");
        await events.Received(1).PostRunningAsync(resetId, Arg.Any<CancellationToken>());
    }

    // ── §7.1 reset-started: no-op ─────────────────────────────────────────────

    [Fact]
    public async Task ResetStarted_IsNoOp_NeitherAckNorRunningPosted()
    {
        var id = "01J9STARTED";
        var data = MakeEventData(id: id, type: "reset-started", resetId: "01J9INIT");

        var loop = MakePollLoop();
        loop.Pause(); // already paused by prior reset-initiated

        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: id, EventType: "reset-started", Data: data));

        await RunListenerOnceAsync(stream, events, [loop]);

        Assert.True(loop.IsPaused, "Loop must remain paused on reset-started");
        await events.DidNotReceive().PostAckAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await events.DidNotReceive().PostRunningAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ── §7.1 unknown event_type: no-op ────────────────────────────────────────

    [Fact]
    public async Task UnknownEventType_IsNoOp()
    {
        var data = MakeEventData(id: "01J9UNKNOWN", type: "future-event-type");

        var loop = MakePollLoop();
        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: "01J9UNKNOWN", EventType: "future-event-type", Data: data));

        await RunListenerOnceAsync(stream, events, [loop]);

        Assert.False(loop.IsPaused, "Unknown event must not pause the loop");
        await events.DidNotReceive().PostAckAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await events.DidNotReceive().PostRunningAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ── §7.1 ping heartbeat: no event dispatched ──────────────────────────────

    [Fact]
    public async Task Ping_IsHeartbeat_NoEventDispatched()
    {
        var events = Substitute.For<IComponentEventClient>();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: true, Id: null, EventType: null, Data: null));

        await RunListenerOnceAsync(stream, events, []);

        await events.DidNotReceive().PostAckAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
        await events.DidNotReceive().PostRunningAsync(Arg.Any<string>(), Arg.Any<CancellationToken>());
    }

    // ── §7.1 Last-Event-ID sent on reconnect ─────────────────────────────────

    [Fact]
    public async Task Reconnect_SendsLastEventId()
    {
        var firstId = "01J9FIRST";
        var secondId = "01J9SECOND";

        var resetData = MakeEventData(id: firstId, type: "reset-initiated");
        var completedData = MakeEventData(id: secondId, type: "reset-completed", resetId: firstId);

        string? capturedReconnectLastId = null;
        // Signals that the second (reconnect) StreamAsync call has been entered.
        var reconnectCalled = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var client = Substitute.For<IControlStreamClient>();
        var callCount = 0;
        client.StreamAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
              .Returns(args =>
              {
                  var lastId = (string?)args[0];
                  callCount++;
                  if (callCount == 1)
                  {
                      // First connection: deliver the two events.
                      return new[]
                      {
                          new ParsedSseEvent(IsPing: false, Id: firstId,  EventType: "reset-initiated", Data: resetData),
                          new ParsedSseEvent(IsPing: false, Id: secondId, EventType: "reset-completed", Data: completedData),
                      }.ToAsyncEnumerable();
                  }

                  // Second connection: capture the Last-Event-ID and signal.
                  capturedReconnectLastId = lastId;
                  reconnectCalled.TrySetResult(true);
                  return Array.Empty<ParsedSseEvent>().ToAsyncEnumerable();
              });

        var loop = MakePollLoop();
        var events = Substitute.For<IComponentEventClient>();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var listener = new ControlStreamListener(
            client, events, [loop],
            NullLogger<ControlStreamListener>.Instance);

        await listener.StartAsync(cts.Token);

        // Wait until the reconnect actually happens (listener's 2 s delay + processing).
        await reconnectCalled.Task.WaitAsync(TimeSpan.FromSeconds(8), cts.Token);
        cts.Cancel();
        try { await listener.StopAsync(CancellationToken.None); } catch { /* expected */ }

        // The reconnect call must carry the last event id seen in the first stream pass.
        Assert.Equal(secondId, capturedReconnectLastId);
    }

    // ── §7.1 ack POST failure: subscriber stays paused, recovers on reset-completed

    [Fact]
    public async Task AckPostFails_ListenerStaysPaused_ThenRecoversOnCompleted()
    {
        var initiatedId = "01J9INITIATED";
        var completedId = "01J9COMPLETED";
        var initiatedData = MakeEventData(id: initiatedId, type: "reset-initiated");
        var completedData = MakeEventData(id: completedId, type: "reset-completed", resetId: initiatedId);

        var events = Substitute.For<IComponentEventClient>();
        // Ack throws — non-fatal (§5.10.4).
        events.PostAckAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
              .Returns<Task>(_ => throw new HttpRequestException("ack failed"));

        var loop = MakePollLoop();
        var stream = MakeStream(
            new ParsedSseEvent(IsPing: false, Id: initiatedId, EventType: "reset-initiated", Data: initiatedData),
            new ParsedSseEvent(IsPing: false, Id: completedId, EventType: "reset-completed", Data: completedData));

        await RunListenerOnceAsync(stream, events, [loop]);

        // Despite ack failure the loop must be resumed on reset-completed.
        Assert.False(loop.IsPaused, "Loop must be resumed after reset-completed even when ack failed");
        await events.Received(1).PostRunningAsync(initiatedId, Arg.Any<CancellationToken>());
    }

    // ── §7.1 COMPONENT_ID override reflected in the HTTP client ──────────────

    /// <summary>
    /// The <see cref="ComponentEventClient"/> is wired in DI with <c>X-Component-Id</c> from
    /// <c>FetcherOptions.ComponentId</c>. This test verifies the client construction logic by
    /// constructing a client with a custom header and asserting the right header is sent.
    /// </summary>
    [Fact]
    public async Task ComponentEventClient_UsesConfiguredComponentId()
    {
        var customComponentId = "my-custom-fetcher";
        var sentRequests = new List<HttpRequestMessage>();

        var handler = new CapturingHandler(sentRequests, System.Net.HttpStatusCode.NoContent);
        using var http = new HttpClient(handler) { BaseAddress = new Uri("http://api") };
        http.DefaultRequestHeaders.Add("X-Component-Id", customComponentId);
        http.DefaultRequestHeaders.Add("X-Api-Key", "test-key");

        var client = new ComponentEventClient(http, NullLogger<ComponentEventClient>.Instance);
        await client.PostAckAsync("some-reset-id", CancellationToken.None);

        Assert.Single(sentRequests);
        Assert.True(sentRequests[0].Headers.TryGetValues("X-Component-Id", out var vals));
        Assert.Equal(customComponentId, vals!.Single());
    }

    // ── PollLoop pause/resume unit ────────────────────────────────────────────

    [Fact]
    public async Task PollLoop_PausedByResetInitiated_FetchNotCalledWhilePaused()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        var fetchCallCount = 0;
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
               .Returns(_ =>
               {
                   fetchCallCount++;
                   return EmptyChunks();
               });

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns((string?)null);

        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(5),
            NullLogger<PollLoop>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        var runTask = loop.RunAsync(cts.Token);

        // Let it poll once.
        await Task.Delay(30, CancellationToken.None);
        var countBeforePause = fetchCallCount;

        loop.Pause();
        await Task.Delay(100, CancellationToken.None);
        var countWhilePaused = fetchCallCount;

        // Count must not have grown while paused.
        Assert.Equal(countBeforePause, countWhilePaused);

        cts.Cancel();
        await runTask;
    }

    [Fact]
    public async Task PollLoop_DropCursorAndResume_CursorIsNullOnNextPoll()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");

        string? receivedCursor = "sentinel"; // will be overwritten on first fetch
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
               .Returns(args =>
               {
                   receivedCursor = (string?)args[0];
                   return EmptyChunks();
               });

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        // Initial state returns a cursor; after reset it returns 404 (null).
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns("existing-cursor");

        var loop = new PollLoop(adapter, ingest, state,
            pollInterval: TimeSpan.FromMilliseconds(20),
            NullLogger<PollLoop>.Instance);

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
        var runTask = loop.RunAsync(cts.Token);

        // Pause and then resume with null cursor.
        await Task.Delay(10, CancellationToken.None);
        loop.Pause();
        await Task.Delay(30, CancellationToken.None);
        loop.DropCursorAndResume();

        // Wait for one more poll to execute after resume.
        await Task.Delay(80, CancellationToken.None);
        cts.Cancel();
        await runTask;

        // The cursor passed to FetchAsync after DropCursorAndResume must be null.
        Assert.Null(receivedCursor);
    }

    // ── Nested helper ─────────────────────────────────────────────────────────

    private sealed class CapturingHandler(
        List<HttpRequestMessage> captured,
        System.Net.HttpStatusCode status) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            captured.Add(request);
            return Task.FromResult(new HttpResponseMessage(status));
        }
    }
}

// Extension to convert arrays to IAsyncEnumerable for NSubstitute returns.
file static class AsyncEnumerableExtensions
{
    public static async IAsyncEnumerable<T> ToAsyncEnumerable<T>(this IEnumerable<T> source)
    {
        foreach (var item in source)
            yield return item;
        await Task.CompletedTask;
    }
}
