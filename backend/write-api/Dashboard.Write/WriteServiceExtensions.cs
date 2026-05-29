using Dashboard.Shared.Abstractions;
using Dashboard.Write.Notifiers;
using Dashboard.Write.Repositories;
using Dashboard.Write.Services;
using Dashboard.Write.Validation;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Write;

public static class WriteServiceExtensions
{
    public static IServiceCollection AddWriteServices(this IServiceCollection services)
    {
        services.AddScoped<IDeploymentNotifier, PostgresDeploymentNotifier>();
        services.AddScoped<IDeploymentIngestService, DeploymentIngestService>();
        services.AddScoped<IIngestValidator, IngestValidator>();
        services.AddScoped<IFetcherStateRepository, FetcherStateRepository>();
        return services;
    }
}
