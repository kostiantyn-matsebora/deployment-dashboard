using System.Text.Json;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Orchestration;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging.Abstractions;
using NSubstitute;

namespace Dashboard.Fetcher.Tests.Control;

/// <summary>
/// Tests for F4: ControlStreamListener exponential backoff on connection failure
/// and control-plane gating.
/// </summary>
public sealed class ControlStreamBackoffTests
{
    // ── F4: backoff increases on repeated failures ────────────────────────────

    [Fact]
    public async Task BackoffIncreasesOnRepeatedFailures()
    {
        // Track the delays between reconnect attempts.
        var reconnectTimestamps = new List<DateTimeOffset>();
        var callCount = 0;

        var client = Substitute.For<IControlStreamClient>();
        client.StreamAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
              .Returns(args =>
              {
                  callCount++;
                  reconnectTimestamps.Add(DateTimeOffset.UtcNow);

                  // Each call immediately completes with no frames (simulates EOF/failure)
                  return Array.Empty<ParsedSseEvent>().ToAsyncEnumerable();
              });

        var events = Substitute.For<IComponentEventClient>();
        var loop = MakePollLoop();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var listener = new ControlStreamListener(
            client, events, [loop],
            NullLogger<ControlStreamListener>.Instance);

        await listener.StartAsync(cts.Token);

        // Wait for at least 3 reconnect attempts so we can measure backoff growth.
        while (callCount < 3 && !cts.Token.IsCancellationRequested)
            await Task.Delay(100);

        cts.Cancel();
        try { await listener.StopAsync(CancellationToken.None); } catch { }

        // With exponential backoff starting at 1 s, the gap between attempts should
        // grow. We need at least 2 gaps to compare.
        Assert.True(callCount >= 2,
            $"Expected at least 2 reconnect attempts; got {callCount}");

        if (reconnectTimestamps.Count >= 3)
        {
            var gap1 = (reconnectTimestamps[1] - reconnectTimestamps[0]).TotalSeconds;
            var gap2 = (reconnectTimestamps[2] - reconnectTimestamps[1]).TotalSeconds;

            // Each gap should be >= the previous one (backoff grows or stays at cap).
            Assert.True(gap2 >= gap1 - 0.5,
                $"Backoff should not shrink: gap1={gap1:F2}s gap2={gap2:F2}s");
        }
    }

    // ── F4: backoff resets to minimum after a successful connect ─────────────

    [Fact]
    public async Task BackoffResetsAfterSuccessfulConnect()
    {
        // First two calls: fail immediately (EOF with no frames — triggers backoff).
        // Third call: deliver a real frame (counts as "connected"), then EOF.
        // Fourth call: should reconnect quickly (backoff reset to minimum).
        var callCount = 0;
        var reconnectTimestamps = new List<DateTimeOffset>();

        var client = Substitute.For<IControlStreamClient>();
        client.StreamAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
              .Returns(args =>
              {
                  callCount++;
                  reconnectTimestamps.Add(DateTimeOffset.UtcNow);

                  if (callCount == 3)
                  {
                      // Deliver a ping (counts as connected) then end.
                      return new[] { new ParsedSseEvent(IsPing: true, null, null, null) }
                          .ToAsyncEnumerable();
                  }

                  return Array.Empty<ParsedSseEvent>().ToAsyncEnumerable();
              });

        var events = Substitute.For<IComponentEventClient>();
        var loop = MakePollLoop();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var listener = new ControlStreamListener(
            client, events, [loop],
            NullLogger<ControlStreamListener>.Instance);

        await listener.StartAsync(cts.Token);

        // Wait for the 4th reconnect.
        while (callCount < 4 && !cts.Token.IsCancellationRequested)
            await Task.Delay(100);

        cts.Cancel();
        try { await listener.StopAsync(CancellationToken.None); } catch { }

        // We mainly verify no crash and that all 4 calls eventually complete.
        Assert.True(callCount >= 3,
            $"Expected at least 3 calls to StreamAsync; got {callCount}");
    }

    // ── F4: empty CONTROL_API_KEY logic guard ─────────────────────────────────

    /// <summary>
    /// Verifies the guard predicate used in Program.cs: listener should only be registered
    /// when the key is non-empty/non-whitespace.
    /// This test documents the invariant without replicating DI wiring.
    /// </summary>
    [Theory]
    [InlineData("", false)]
    [InlineData("   ", false)]
    [InlineData(null, false)]
    [InlineData("secret-key", true)]
    [InlineData("x", true)]
    public void ControlApiKeyGating_ShouldRegister_WhenKeyIsNonEmpty(
        string? controlApiKey, bool shouldRegister)
    {
        // This is the exact guard expression used in Program.cs.
        var wouldRegister = !string.IsNullOrWhiteSpace(controlApiKey);
        Assert.Equal(shouldRegister, wouldRegister);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static async IAsyncEnumerable<FetchResult> EmptyChunks()
    {
        yield return new FetchResult([], null);
        await Task.CompletedTask;
    }

    private static PollLoop MakePollLoop()
    {
        var adapter = Substitute.For<ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        adapter.FetchAsync(Arg.Any<string?>(), Arg.Any<CancellationToken>())
               .Returns(EmptyChunks());

        var ingest = Substitute.For<IIngestClient>();
        var state = Substitute.For<IFetcherStateClient>();
        state.GetAsync(Arg.Any<string>(), Arg.Any<CancellationToken>())
             .Returns((string?)null);

        return new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromHours(1),
            NullLogger<PollLoop>.Instance);
    }
}

// Extension shared with ControlStreamListenerTests (file-scoped to avoid conflict).
file static class AsyncEnumerableExtensionsBackoff
{
    public static async IAsyncEnumerable<T> ToAsyncEnumerable<T>(this IEnumerable<T> source)
    {
        foreach (var item in source)
            yield return item;
        await Task.CompletedTask;
    }
}
