using Dashboard.Control.Services;
using Dashboard.Control.Sse;
using Dashboard.Control.Validation;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Dashboard.Control;

public static class ControlServiceExtensions
{
    public static IServiceCollection AddControlServices(this IServiceCollection services)
    {
        services.AddScoped<IResetService, ResetService>();
        services.AddSingleton<IComponentEventValidator, ComponentEventValidator>();

        // Control SSE broadcaster: one singleton serves as both IControlEventBroadcaster
        // (injected into the stream handler) and the BackgroundService owning LISTEN control_events.
        // It also satisfies IControlReadinessIndicator for the /readyz dual-channel check (D10).
        services.AddSingleton<ControlEventBroadcaster>();
        services.AddSingleton<IControlEventBroadcaster>(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());
        services.AddSingleton<IControlReadinessIndicator>(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());
        services.AddHostedService(
            sp => sp.GetRequiredService<ControlEventBroadcaster>());

        return services;
    }
}
