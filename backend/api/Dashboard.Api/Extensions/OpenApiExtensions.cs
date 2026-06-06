using Scalar.AspNetCore;

namespace Dashboard.Api.Extensions;

internal static class OpenApiExtensions
{
    /// <summary>
    /// Registers the OpenAPI document with the canonical API title, version, and description.
    /// </summary>
    internal static IServiceCollection AddDashboardOpenApi(this IServiceCollection services)
    {
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer((doc, _, _) =>
            {
                doc.Info.Title = "Deployment Dashboard API";
                doc.Info.Version = "v1";
                doc.Info.Description = "Write and read deployment events.";
                return Task.CompletedTask;
            });
        });

        return services;
    }

    /// <summary>
    /// Maps the OpenAPI JSON endpoint and the Scalar interactive UI reference.
    /// </summary>
    internal static WebApplication MapDashboardOpenApi(this WebApplication app)
    {
        app.MapOpenApi();
        app.MapScalarApiReference();

        return app;
    }
}
