using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Host.Workers;

/// <summary>
/// BackgroundService that starts one PollLoop per registered ICiCdAdapter (§3).
/// Single replica per adapter — no leader election (F6).
/// </summary>
public sealed class FetcherWorker(
    IEnumerable<ICiCdAdapter> adapters,
    IIngestClient ingestClient,
    IFetcherStateClient stateClient,
    FetcherOptions options,
    ILoggerFactory loggerFactory) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var loops = adapters.Select(adapter =>
        {
            var logger = loggerFactory.CreateLogger<PollLoop>();
            var loop = new PollLoop(adapter, ingestClient, stateClient, options.PollInterval, logger);
            return loop.RunAsync(stoppingToken);
        }).ToList();

        await Task.WhenAll(loops);
    }
}
