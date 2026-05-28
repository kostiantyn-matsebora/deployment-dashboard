using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Api.Extensions;

internal static class ProblemDetailsExtensions
{
    /// <summary>
    /// Registers RFC 9457 problem-details services and maps <see cref="System.Text.Json.JsonException"/>
    /// (thrown on unknown fields or malformed JSON, per D5) to <c>422 application/problem+json</c>.
    /// </summary>
    internal static IServiceCollection AddDashboardProblemDetails(this IServiceCollection services)
    {
        services.AddProblemDetails(opts =>
            opts.CustomizeProblemDetails = MapJsonExceptionToProblemDetails);

        return services;
    }

    private static void MapJsonExceptionToProblemDetails(ProblemDetailsContext ctx)
    {
        var exception = ctx.HttpContext.Features
            .Get<IExceptionHandlerFeature>()?.Error;

        var jsonEx = exception as System.Text.Json.JsonException
            ?? exception?.InnerException as System.Text.Json.JsonException;

        if (jsonEx is null) return;

        ctx.ProblemDetails.Status = StatusCodes.Status422UnprocessableEntity;
        ctx.ProblemDetails.Title = "Unprocessable payload.";
        ctx.ProblemDetails.Detail = "The request body is malformed or contains unknown fields.";
        ctx.HttpContext.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;

        var pointer = jsonEx.Path is { } p
            ? $"/{p.Replace(".", "/").TrimStart('$', '.')}"
            : "/";
        ctx.ProblemDetails.Extensions["errors"] = new[] { new { pointer, message = jsonEx.Message } };
    }
}
