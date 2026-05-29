using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Dashboard.Read.Sse;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Read;

public static class ReadServiceExtensions
{
    public static IServiceCollection AddReadServices(this IServiceCollection services)
    {
        services.AddScoped<IDeploymentReadRepository, DeploymentReadRepository>();
        services.AddScoped<IMatrixService, MatrixService>();

        // SSE broadcaster: one singleton instance serves as both IDeploymentEventBroadcaster
        // (injected into the SSE handler) and the BackgroundService that owns the LISTEN connection.
        services.AddSingleton<DeploymentEventBroadcaster>();
        services.AddSingleton<IDeploymentEventBroadcaster>(
            sp => sp.GetRequiredService<DeploymentEventBroadcaster>());
        services.AddSingleton<IReadinessIndicator>(
            sp => sp.GetRequiredService<DeploymentEventBroadcaster>());
        services.AddHostedService(
            sp => sp.GetRequiredService<DeploymentEventBroadcaster>());

        return services;
    }
}
