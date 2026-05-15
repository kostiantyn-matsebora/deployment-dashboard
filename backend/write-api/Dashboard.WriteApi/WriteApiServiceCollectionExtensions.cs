using Dashboard.Shared.Realtime;
using Dashboard.Shared.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dashboard.WriteApi;

/// <summary>
/// DI registrations specific to the Write surface (SAD §7 "Backend module
/// architecture" + §10 Decision 11). Called from the API host's
/// composition root via <c>services.AddWriteApi(configuration)</c>.
///
/// <para>The Write surface needs:</para>
/// <list type="bullet">
///   <item><see cref="ApiKeyOptions"/> bound from <c>API_TOKEN</c> (env var
///   wins over <c>appsettings.json</c> per SAD §6 / FR-10).</item>
///   <item><see cref="DeploymentNotifier"/> with a dedicated Postgres
///   connection string for NOTIFY dispatch (separate from the EF Core pool —
///   SAD §7 Real-time path).</item>
///   <item>The <see cref="ApiKeyMiddleware"/> endpoint filter type itself,
///   registered as transient so <c>AddEndpointFilter&lt;T&gt;()</c> can
///   activate it per-request.</item>
/// </list>
///
/// <para>EF Core <c>DbContext</c> and JSON options are owned by the host
/// (shared across surfaces — see <c>backend/api/</c>). They are NOT
/// re-registered here.</para>
/// </summary>
public static class WriteApiServiceCollectionExtensions
{
    public static IServiceCollection AddWriteApi(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var apiKey = Environment.GetEnvironmentVariable("API_TOKEN")
            ?? configuration["API_TOKEN"]
            ?? string.Empty;
        services.AddSingleton(new ApiKeyOptions { ApiKey = apiKey });

        // The endpoint filter is resolved by ActivatorUtilities when
        // AddEndpointFilter<ApiKeyMiddleware>() runs, but it also needs to
        // be discoverable as a service for test scenarios that resolve it
        // directly. Transient is correct — the filter is per-request.
        services.AddTransient<ApiKeyMiddleware>();

        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection (env ConnectionStrings__DefaultConnection) is required.");

        services.AddSingleton(sp => new DeploymentNotifier(
            connectionString,
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<DeploymentNotifier>()));

        return services;
    }
}
