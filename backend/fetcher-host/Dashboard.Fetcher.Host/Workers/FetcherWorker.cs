using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Fetcher.Host.Workers;

/// <summary>
/// BackgroundService that runs every registered <see cref="PollLoop"/> concurrently (§3),
/// plus the slow-cadence <see cref="DiscoveryLoop"/> (issue #391 / §5.6.2) — a separate
/// loop with its own cadence, independent of the deployment poll loops.
/// Single replica per adapter — no leader election (F6).
/// Loops are shared singletons so <see cref="ControlStreamListener"/> can pause / resume them.
/// </summary>
public sealed class FetcherWorker(
    IReadOnlyList<PollLoop> pollLoops, DiscoveryLoop? discoveryLoop = null) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var tasks = pollLoops
            .Select(loop => loop.RunAsync(stoppingToken))
            .ToList();

        if (discoveryLoop is not null)
            tasks.Add(discoveryLoop.RunAsync(stoppingToken));

        return Task.WhenAll(tasks);
    }
}
