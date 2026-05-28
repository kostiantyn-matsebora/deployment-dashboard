using Dashboard.Shared.Contracts;
using Dashboard.Write.Validation;
using Microsoft.AspNetCore.Http;

namespace Dashboard.Write.Filters;

/// <summary>
/// Endpoint filter that validates <see cref="DeploymentEventIngest"/> request bodies.
/// Delegates rule evaluation to <see cref="IIngestValidator"/>.
/// Failures → <c>422 application/problem+json</c> with <c>errors[]</c> (RFC 9457 extension).
/// </summary>
internal sealed class ValidationEndpointFilter(IIngestValidator validator) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var body = context.Arguments.OfType<DeploymentEventIngest>().FirstOrDefault();
        if (body is null)
            return MissingBodyResult();

        var failures = validator.Validate(body);
        return failures.Count > 0 ? UnprocessableEntity(failures) : await next(context);
    }

    private static IResult MissingBodyResult() =>
        Results.Problem(
            title: "Unprocessable payload.",
            detail: "The request body is missing, malformed, or contains unknown fields.",
            statusCode: StatusCodes.Status422UnprocessableEntity,
            extensions: new Dictionary<string, object?> { ["errors"] = Array.Empty<object>() });

    private static IResult UnprocessableEntity(IReadOnlyList<ValidationFailure> failures)
    {
        var errors = failures
            .Select(f => new { pointer = f.Pointer, message = f.Message })
            .ToArray();

        return Results.Problem(
            title: "One or more validation errors occurred.",
            statusCode: StatusCodes.Status422UnprocessableEntity,
            extensions: new Dictionary<string, object?> { ["errors"] = errors });
    }
}
