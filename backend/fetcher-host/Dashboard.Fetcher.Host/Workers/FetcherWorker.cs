using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Fetcher.Host.Workers;

/// <summary>
/// BackgroundService that runs every registered <see cref="PollLoop"/> concurrently (§3).
/// Single replica per adapter — no leader election (F6).
/// Loops are shared singletons so <see cref="ControlStreamListener"/> can pause / resume them.
/// </summary>
public sealed class FetcherWorker(IReadOnlyList<PollLoop> pollLoops) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tasks = pollLoops
            .Select(loop => loop.RunAsync(stoppingToken))
            .ToList();

        return Task.WhenAll(tasks);
    }
}
