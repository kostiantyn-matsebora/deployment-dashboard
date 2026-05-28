using Dashboard.Shared.Abstractions;
using Dashboard.Write.Notifiers;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Write;

public static class WriteServiceExtensions
{
    public static IServiceCollection AddWriteServices(this IServiceCollection services)
    {
        services.AddScoped<IDeploymentNotifier, PostgresDeploymentNotifier>();
        return services;
    }
}
