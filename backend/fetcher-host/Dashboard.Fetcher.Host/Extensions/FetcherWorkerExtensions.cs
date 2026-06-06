using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Host.Workers;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Host.Extensions;

/// <summary>
/// Registers the hosted-service workers for the fetcher host.
/// </summary>
internal static class FetcherWorkerExtensions
{
    /// <summary>
    /// Adds <see cref="FetcherWorker"/> unconditionally, and <see cref="ControlStreamListener"/>
    /// only when <c>CONTROL_API_KEY</c> is set (§5.10.2 / F4).
    /// When the key is absent, logs once at startup so the absence is observable.
    /// </summary>
    internal static IServiceCollection AddFetcherWorkers(
        this IServiceCollection services,
        FetcherOptions fetcherOptions)
    {
        services.AddHostedService<FetcherWorker>();

        // F4: register ControlStreamListener only when CONTROL_API_KEY is set.
        // An empty key means the API's control surface is disabled; attempting to connect
        // would 404-loop. Log once at startup so the absence is observable.
        if (!string.IsNullOrWhiteSpace(fetcherOptions.ControlApiKey))
        {
            services.AddHostedService<ControlStreamListener>();
        }
        else
        {
            var startupLogger = LoggerFactory.Create(b => b.AddConsole())
                .CreateLogger("Startup");
            startupLogger.LogInformation(
                "[ControlStream] CONTROL_API_KEY is not set — control-plane participation disabled");
        }

        return services;
    }
}
