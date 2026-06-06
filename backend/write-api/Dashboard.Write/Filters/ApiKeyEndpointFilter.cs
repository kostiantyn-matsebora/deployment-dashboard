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
    internal const string HeaderName = "X-Api-Key";
    internal const string ApiKeyConfigKey = "API_KEY";

    // Resolved once at construction; IConfiguration is loaded at startup and does not
    // change at runtime, so reading the key per-request is unnecessary overhead.
    private readonly string? _configuredKey = configuration[ApiKeyConfigKey];

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
