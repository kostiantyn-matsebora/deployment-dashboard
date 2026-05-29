using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Read;

public static class ReadServiceExtensions
{
    public static IServiceCollection AddReadServices(this IServiceCollection services)
    {
        services.AddScoped<IDeploymentReadRepository, DeploymentReadRepository>();
        services.AddScoped<IMatrixService, MatrixService>();
        return services;
    }
}
