using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Api.Extensions;

internal static class JsonExtensions
{
    /// <summary>
    /// Configures the global JSON serialization policy: snake_case response properties
    /// and null fields omitted from responses (per the API snake_case contract).
    /// Ingest DTOs use <c>[JsonPropertyName]</c> which takes precedence over this policy.
    /// </summary>
    internal static IServiceCollection AddDashboardJsonOptions(this IServiceCollection services)
    {
        services.ConfigureHttpJsonOptions(opts =>
        {
            opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
            opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });

        return services;
    }
}
