using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Control.Filters;

/// <summary>
/// Endpoint filter that enforces <c>X-Api-Key</c> authentication on the component-event
/// ingest endpoint. Missing or invalid key → <c>401 application/problem+json</c>.
/// The key value is never logged or echoed. Mirrors <c>Dashboard.Write.Filters.ApiKeyEndpointFilter</c>
/// (each endpoint-group library owns its own filter; the future-split seam stays clean).
/// </summary>
internal sealed class ApiKeyEndpointFilter(IConfiguration configuration) : IEndpointFilter
{
    private const string HeaderName = "X-Api-Key";

    private readonly string? _configuredKey = configuration["API_KEY"];

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var providedKey = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();

        if (string.IsNullOrEmpty(_configuredKey) || providedKey != _configuredKey)
        {
            return Results.Problem(
                title: "Unauthorized.",
                detail: "Missing or invalid X-Api-Key.",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        return await next(context);
    }
}
