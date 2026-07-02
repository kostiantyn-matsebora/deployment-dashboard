using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Orchestration;

/// <summary>
/// Tests for <see cref="DiscoveryLoop"/> — the slow-cadence discovery loop wrapper
/// (issue #391 / §5.6.2), sibling to <see cref="PollLoop"/> but with its own cadence and
/// no cursor/pause semantics. Plain delegate injected — no mocking needed.
/// </summary>
public sealed class DiscoveryLoopTests
{
    [Fact]
    public async Task RunAsync_InvokesDelegate_OnEachInterval()
    {
        var callCount = 0;
        Task RunOnce(CancellationToken ct)
        {
            callCount++;
            return Task.CompletedTask;
        }

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var loop = new DiscoveryLoop(RunOnce, TimeSpan.FromMilliseconds(10), NullLogger<DiscoveryLoop>.Instance);

        await loop.RunAsync(cts.Token);

        Assert.True(callCount >= 2, $"Expected at least 2 cycles, got {callCount}");
    }

    [Fact]
    public async Task RunAsync_CycleThrows_LoopContinuesToNextInterval()
    {
        var callCount = 0;
        Task RunOnce(CancellationToken ct)
        {
            callCount++;
            if (callCount == 1)
                throw new InvalidOperationException("simulated cycle failure");
            return Task.CompletedTask;
        }

        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(80));
        var loop = new DiscoveryLoop(RunOnce, TimeSpan.FromMilliseconds(10), NullLogger<DiscoveryLoop>.Instance);

        var exception = await Record.ExceptionAsync(() => loop.RunAsync(cts.Token));

        Assert.Null(exception);
        Assert.True(callCount >= 2, $"Expected the loop to continue past the failing cycle, got {callCount} calls");
    }

    [Fact]
    public async Task RunAsync_Cancelled_ReturnsCleanly()
    {
        Task RunOnce(CancellationToken ct) => Task.CompletedTask;

        using var cts = new CancellationTokenSource();
        var loop = new DiscoveryLoop(RunOnce, TimeSpan.FromMilliseconds(10), NullLogger<DiscoveryLoop>.Instance);

        cts.Cancel();
        var exception = await Record.ExceptionAsync(() => loop.RunAsync(cts.Token));

        Assert.Null(exception);
    }
}
