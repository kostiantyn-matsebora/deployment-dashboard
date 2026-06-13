using Dashboard.Read.Analytics;
using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Dashboard.Read.Sse;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Read;

public static class ReadServiceExtensions
{
    public static IServiceCollection AddReadServices(this IServiceCollection services, IConfiguration configuration)
    {
        // Parse all analytics env vars once at the composition root — never per-request.
        var rawFunnel = configuration["ANALYTICS_FUNNEL_ENVIRONMENTS"];
        var rawGranularity = configuration["ANALYTICS_WINDOW_GRANULARITY"];
        var rawRetention = configuration["HISTORY_RETENTION_DAYS"];

        var granularity = string.Equals(rawGranularity, "hour", StringComparison.OrdinalIgnoreCase)
            ? AnalyticsWindowGranularity.Hour
            : AnalyticsWindowGranularity.Day;

        var retentionDays = int.TryParse(rawRetention, out var r) && r >= 90 ? r : 365;

        var analyticsOptions = new AnalyticsOptions(
            FunnelEnvironments: AnalyticsFunnelEnvironments.Parse(rawFunnel),
            Granularity: granularity,
            RetentionDays: retentionDays);

        services.AddSingleton(analyticsOptions);

        services.AddScoped<IDeploymentReadRepository, DeploymentReadRepository>();
        services.AddScoped<IMatrixService, MatrixService>();
        services.AddScoped<IAnalyticsRepository, AnalyticsRepository>();

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
