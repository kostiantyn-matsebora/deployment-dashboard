using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Configuration;
using Dashboard.Shared.Data;
using Npgsql;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Extensions;

/// <summary>
/// Host wiring extracted from <c>Program.cs</c> so the composition root reads as a flat list of
/// registrations and pipeline steps (one altitude per line, concerns in dedicated helpers).
/// </summary>
internal static class HostingExtensions
{
    private const string CorsOriginsKey = "CORS_ALLOWED_ORIGINS";

    /// <summary>
    /// Global snake_case JSON policy for response DTOs. The ingest DTO's <c>[JsonPropertyName]</c>
    /// attributes take precedence over this convention.
    /// </summary>
    internal static IServiceCollection AddApiJsonOptions(this IServiceCollection services)
    {
        services.ConfigureHttpJsonOptions(opts =>
        {
            opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
            opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });
        return services;
    }

    /// <summary>
    /// Registers the EF Core context, exposing <c>ConnectionStrings:Postgres</c> as a synthetic key
    /// computed lazily from flat <c>POSTGRES_*</c> env vars (highest priority) → appsettings
    /// <c>Postgres:*</c> → built-in defaults. Added last so it wins and always reads the live config.
    /// </summary>
    internal static WebApplicationBuilder AddDashboardDatabase(this WebApplicationBuilder builder)
    {
        ((IConfigurationBuilder)builder.Configuration).Add(new PostgresConnectionStringSource(builder.Configuration));

        // Single shared NpgsqlDataSource — handles both pooled EF connections and the long-lived
        // SSE LISTEN connections.  In managed-identity mode it carries a periodic-password provider
        // that refreshes the token automatically; in password mode it behaves as before.
        // Disposal: ASP.NET Core's DI container disposes IAsyncDisposable singletons on host
        // shutdown, so NpgsqlDataSource (which implements IAsyncDisposable) is cleaned up correctly.
        builder.Services.AddSingleton(_ =>
            NpgsqlDataSourceFactory.Create(builder.Configuration));

        builder.Services.AddDbContext<DashboardDbContext>((sp, options) =>
            options.UseNpgsql(sp.GetRequiredService<NpgsqlDataSource>()));

        return builder;
    }

    /// <summary>
    /// Adds a CORS default policy only when <c>CORS_ALLOWED_ORIGINS</c> is set; empty/absent = off
    /// (gateway / same-origin deployments). D6.
    /// </summary>
    internal static IServiceCollection AddApiCors(this IServiceCollection services, IConfiguration configuration)
    {
        var origins = ReadCorsOrigins(configuration);
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

    /// <summary>Applies the CORS middleware only when <c>CORS_ALLOWED_ORIGINS</c> is configured.</summary>
    internal static WebApplication UseApiCorsIfConfigured(this WebApplication app, IConfiguration configuration)
    {
        if (ReadCorsOrigins(configuration).Length > 0)
            app.UseCors();
        return app;
    }

    /// <summary>
    /// Applies pending EF Core migrations at startup (production / development / staging).
    /// In the <c>Test</c> environment, calls <c>EnsureCreated</c> instead so in-memory and
    /// SQLite providers used in unit tests are not asked to run Postgres-targeted migrations.
    /// </summary>
    internal static async Task MigrateDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        if (app.Environment.IsEnvironment("Test"))
            await db.Database.EnsureCreatedAsync();
        else
            await db.Database.MigrateAsync();
    }

    private static string[] ReadCorsOrigins(IConfiguration configuration)
    {
        var raw = configuration[CorsOriginsKey];
        return string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }
}
