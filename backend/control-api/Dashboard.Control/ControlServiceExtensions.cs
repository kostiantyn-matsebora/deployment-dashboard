using Dashboard.Control.Services;
using Dashboard.Control.Validation;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Control;

public static class ControlServiceExtensions
{
    public static IServiceCollection AddControlServices(this IServiceCollection services)
    {
        services.AddScoped<IResetService, ResetService>();
        services.AddSingleton<IComponentEventValidator, ComponentEventValidator>();
        return services;
    }
}
