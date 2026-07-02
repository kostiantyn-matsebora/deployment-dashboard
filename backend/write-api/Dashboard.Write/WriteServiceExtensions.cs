using Dashboard.Shared.Abstractions;
using Dashboard.Shared.ServiceFiltering;
using Dashboard.Write.Notifiers;
using Dashboard.Write.Repositories;
using Dashboard.Write.Services;
using Dashboard.Write.Validation;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Write;

public static class WriteServiceExtensions
{
    public static IServiceCollection AddWriteServices(this IServiceCollection services, IConfiguration configuration)
    {
        // Parse SERVICE_EXCLUDE once at composition root — never per-request.
        var serviceFilter = ServiceFilter.Parse(configuration["SERVICE_EXCLUDE"]);
        services.AddSingleton(serviceFilter);

        services.AddScoped<IDeploymentNotifier, PostgresDeploymentNotifier>();
        services.AddScoped<IDeploymentIngestService, DeploymentIngestService>();
        services.AddScoped<IIngestValidator, IngestValidator>();
        services.AddScoped<IFetcherStateRepository, FetcherStateRepository>();
        services.AddScoped<IProvidedPresetRepository, ProvidedPresetRepository>();

        // ── Daily retention prune job ─────────────────────────────────────────
        services.AddHostedService<HistoryRetentionService>();

        return services;
    }
}
