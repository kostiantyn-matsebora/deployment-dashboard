using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Security;

/// <summary>
/// Validates the <c>X-Api-Key</c> header against the value held in
/// <see cref="ApiKeyOptions"/>. Returns <c>401 Unauthorized</c> on missing
/// or mismatched keys.
///
/// <para>Auth is scoped to the Write endpoint group only — the Read API
/// surface is unauthenticated (NFR-04 + SAD §8 + Decision §10 #1). The
/// host composition root applies <see cref="RequireApiKey"/> to the
/// write group; there is no global middleware registration.</para>
///
/// <para>This file historically held an <c>IApplicationBuilder</c>-level
/// middleware. With the single-host / two-library-surface composition
/// (SAD §7 "Backend module architecture"; Decision §10 #11), auth must be
/// expressed per-endpoint-group rather than as a pipeline branch. The class
/// is therefore an <see cref="IEndpointFilter"/>, surfaced through the
/// <see cref="RouteHandlerBuilderExtensions.RequireApiKey"/> fluent
/// extension. The header-name constant remains on the type so consumers
/// (and tests) can keep referring to <c>ApiKeyMiddleware.HeaderName</c>.</para>
/// </summary>
public sealed class ApiKeyMiddleware : IEndpointFilter
{
    public const string HeaderName = "X-Api-Key";

    private readonly ApiKeyOptions _options;
    private readonly ILogger<ApiKeyMiddleware> _logger;

    public ApiKeyMiddleware(ApiKeyOptions options, ILogger<ApiKeyMiddleware> logger)
    {
        _options = options;
        _logger = logger;
    }

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context,
        EndpointFilterDelegate next)
    {
        var http = context.HttpContext;

        if (string.IsNullOrEmpty(_options.ApiKey))
        {
            // The Write surface is useless without a configured API key —
            // fail closed rather than silently accept anonymous writes.
            _logger.LogError("API_TOKEN is not configured; rejecting write request.");
            return await WriteUnauthorized(http, "Server is missing API key configuration.");
        }

        if (!http.Request.Headers.TryGetValue(HeaderName, out var provided)
            || string.IsNullOrWhiteSpace(provided))
        {
            return await WriteUnauthorized(http, $"Missing {HeaderName} header.");
        }

        // Constant-time comparison to avoid leaking the secret via timing.
        if (!FixedTimeEquals(provided.ToString(), _options.ApiKey))
        {
            return await WriteUnauthorized(http, "Invalid API key.");
        }

        return await next(context);
    }

    private static async Task<object?> WriteUnauthorized(HttpContext ctx, string message)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { error = message }));
        return Results.Empty;
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        var ba = System.Text.Encoding.UTF8.GetBytes(a);
        var bb = System.Text.Encoding.UTF8.GetBytes(b);
        return System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(ba, bb);
    }
}

/// <summary>Options bag carrying the configured API key.</summary>
public sealed class ApiKeyOptions
{
    public string ApiKey { get; init; } = string.Empty;
}

/// <summary>
/// Endpoint-group conventions for applying API-key auth. SAD §8
/// "Security Considerations" requires this to be scoped to the write
/// endpoint group only — call it on the write group during composition
/// and nowhere else.
///
/// <para>Overloads exist for both <see cref="RouteGroupBuilder"/> (the
/// expected entry point — <c>MapGroup(...).RequireApiKey()</c>) and
/// <see cref="RouteHandlerBuilder"/> (for single-endpoint pinning if a
/// future write endpoint sits outside the group). They forward to
/// <c>AddEndpointFilter&lt;ApiKeyMiddleware&gt;()</c> in either case.</para>
/// </summary>
public static class RouteHandlerBuilderExtensions
{
    /// <summary>
    /// Adds the API-key endpoint filter to every endpoint registered on
    /// this <paramref name="group"/>. Equivalent to the SAD's
    /// <c>MapGroup("/api").RequireApiKey()</c>.
    /// </summary>
    public static RouteGroupBuilder RequireApiKey(this RouteGroupBuilder group)
    {
        group.AddEndpointFilter<ApiKeyMiddleware>();
        return group;
    }

    /// <summary>
    /// Adds the API-key endpoint filter to a single endpoint. Use this
    /// when an endpoint lives outside the write group but still requires
    /// the same auth boundary.
    /// </summary>
    public static RouteHandlerBuilder RequireApiKey(this RouteHandlerBuilder handler)
    {
        handler.AddEndpointFilter<ApiKeyMiddleware>();
        return handler;
    }
}
