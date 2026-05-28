using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Write.Filters;

/// <summary>
/// Endpoint filter that enforces <c>X-Api-Key</c> authentication on write surfaces.
/// Missing or invalid key → <c>401 application/problem+json</c>.
/// The key value is never logged or echoed.
/// </summary>
internal sealed class ApiKeyEndpointFilter(IConfiguration configuration) : IEndpointFilter
{
    private const string HeaderName = "X-Api-Key";

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var configuredKey = configuration["API_KEY"];
        var providedKey = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();

        if (string.IsNullOrEmpty(configuredKey) || providedKey != configuredKey)
        {
            return Results.Problem(
                title: "Unauthorized.",
                detail: "Missing or invalid X-Api-Key.",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        return await next(context);
    }
}
