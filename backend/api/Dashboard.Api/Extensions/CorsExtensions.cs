namespace Dashboard.Api.Extensions;

internal static class CorsExtensions
{
    /// <summary>
    /// Environment variable that lists the allowed CORS origins as a comma-separated
    /// string. When absent or empty, CORS is disabled (gateway / same-origin setup, D6).
    /// </summary>
    internal const string AllowedOriginsKey = "CORS_ALLOWED_ORIGINS";

    /// <summary>
    /// Registers a CORS default policy when <see cref="AllowedOriginsKey"/> is configured.
    /// When the key is absent or empty no CORS services are added, so <c>app.UseCors()</c>
    /// must be guarded by the same check (see <see cref="UseDashboardCors"/>).
    /// </summary>
    internal static IServiceCollection AddDashboardCors(this IServiceCollection services, IConfiguration configuration)
    {
        var origins = ResolveOrigins(configuration);
        if (origins.Length == 0)
            return services;

        services.AddCors(opts =>
            opts.AddDefaultPolicy(policy =>
                policy.WithOrigins(origins)
                      .AllowAnyHeader()
                      .AllowAnyMethod()
                      .DisallowCredentials()));

        return services;
    }

    /// <summary>
    /// Activates CORS middleware only when <see cref="AllowedOriginsKey"/> was configured.
    /// Must be called after <see cref="AddDashboardCors"/>.
    /// </summary>
    internal static WebApplication UseDashboardCors(this WebApplication app)
    {
        var origins = ResolveOrigins(app.Configuration);
        if (origins.Length > 0)
            app.UseCors();

        return app;
    }

    private static string[] ResolveOrigins(IConfiguration configuration)
    {
        var raw = configuration[AllowedOriginsKey];
        if (string.IsNullOrWhiteSpace(raw))
            return [];

        return raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
