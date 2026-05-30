using Dashboard.Control.Services;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Control;

public static class ControlServiceExtensions
{
    public static IServiceCollection AddControlServices(this IServiceCollection services)
    {
        services.AddScoped<IResetService, ResetService>();
        return services;
    }
}
