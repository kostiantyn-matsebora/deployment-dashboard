using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Security;

/// <summary>
/// Validates the <c>X-Api-Key</c> header against the value held in
/// <see cref="ApiKeyOptions"/>. Returns <c>401 Unauthorized</c> on missing
/// or mismatched keys.
///
/// <para>This is intentionally only applied to write paths — the Read API
/// is internal (NFR-04) and read endpoints are unauthenticated per
/// Decision §10 #1.</para>
/// </summary>
public sealed class ApiKeyMiddleware
{
    public const string HeaderName = "X-Api-Key";

    private readonly RequestDelegate _next;
    private readonly ApiKeyOptions _options;
    private readonly ILogger<ApiKeyMiddleware> _logger;

    public ApiKeyMiddleware(
        RequestDelegate next,
        ApiKeyOptions options,
        ILogger<ApiKeyMiddleware> logger)
    {
        _next = next;
        _options = options;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (string.IsNullOrEmpty(_options.ApiKey))
        {
            // The Write API is useless without a configured API key — fail
            // closed rather than silently accept anonymous writes.
            _logger.LogError("API_TOKEN is not configured; rejecting write request.");
            await WriteUnauthorized(context, "Server is missing API key configuration.");
            return;
        }

        if (!context.Request.Headers.TryGetValue(HeaderName, out var provided)
            || string.IsNullOrWhiteSpace(provided))
        {
            await WriteUnauthorized(context, $"Missing {HeaderName} header.");
            return;
        }

        // Constant-time comparison to avoid leaking the secret via timing.
        if (!FixedTimeEquals(provided.ToString(), _options.ApiKey))
        {
            await WriteUnauthorized(context, "Invalid API key.");
            return;
        }

        await _next(context);
    }

    private static async Task WriteUnauthorized(HttpContext ctx, string message)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new { error = message }));
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

/// <summary>Convenience extensions to register the middleware.</summary>
public static class ApiKeyMiddlewareExtensions
{
    public static IApplicationBuilder UseApiKeyAuth(this IApplicationBuilder app, ApiKeyOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return app.UseMiddleware<ApiKeyMiddleware>(options);
    }
}
