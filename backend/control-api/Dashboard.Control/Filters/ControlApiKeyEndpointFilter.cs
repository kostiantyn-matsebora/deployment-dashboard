using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Control.Filters;

/// <summary>
/// Endpoint filter that enforces <c>X-Control-API-Key</c> authentication on the control surface.
/// Missing or invalid key → <c>401 application/problem+json</c>.
/// The key value is never logged or echoed (D8).
/// </summary>
internal sealed class ControlApiKeyEndpointFilter(IConfiguration configuration) : IEndpointFilter
{
    private const string HeaderName = "X-Control-API-Key";

    // Resolved once at construction; IConfiguration is loaded at startup and does not
    // change at runtime, so reading the key per-request is unnecessary overhead.
    private readonly string? _configuredKey = configuration["CONTROL_API_KEY"];

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        // When the control key is not configured the surface is entirely hidden (D8).
        // Returning 404 prevents probing: callers cannot distinguish "wrong key"
        // from "endpoint doesn't exist on this deployment".
        if (string.IsNullOrEmpty(_configuredKey))
            return Results.NotFound();

        var providedKey = context.HttpContext.Request.Headers[HeaderName].FirstOrDefault();

        if (providedKey != _configuredKey)
        {
            return Results.Problem(
                title: "Unauthorized.",
                detail: "Missing or invalid X-Control-API-Key.",
                statusCode: StatusCodes.Status401Unauthorized);
        }

        return await next(context);
    }
}
