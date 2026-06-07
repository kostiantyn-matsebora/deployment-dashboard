using Dashboard.Control.Validation;
using Dashboard.Shared.Contracts;
using Microsoft.AspNetCore.Http;

namespace Dashboard.Control.Filters;

/// <summary>
/// Validates a <c>POST /api/control/events</c> request: the required <c>X-Component-Id</c>
/// header (D9, pattern-checked) and the <see cref="ComponentEventIngest"/> body.
/// Any failure → <c>422 application/problem+json</c> with <c>errors[]</c> (RFC 9457 extension).
/// Mirrors <c>Dashboard.Write.Filters.ValidationEndpointFilter</c>.
/// </summary>
internal sealed class ComponentEventValidationEndpointFilter(IComponentEventValidator validator) : IEndpointFilter
{
    private const int MaxCorrelationIdLength = 128;

    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var failures = new List<ValidationFailure>();

        // X-Component-Id is an identity header (not an auth secret): missing/invalid → 422, not 401.
        var componentId = context.HttpContext.Request.Headers[ComponentId.HeaderName].FirstOrDefault();
        if (!ComponentId.IsValid(componentId))
            failures.Add(new ValidationFailure(
                "/X-Component-Id",
                "Missing or invalid X-Component-Id header. Pattern: ^[a-z0-9][a-z0-9.-]{0,127}$."));

        // X-Correlation-Id is optional; absent → null (no error). Present but >128 chars → 422.
        var correlationId = context.HttpContext.Request.Headers["X-Correlation-Id"].FirstOrDefault();
        if (correlationId is not null && correlationId.Length > MaxCorrelationIdLength)
            failures.Add(new ValidationFailure(
                "/X-Correlation-Id",
                $"X-Correlation-Id must not exceed {MaxCorrelationIdLength} characters."));

        var body = context.Arguments.OfType<ComponentEventIngest>().FirstOrDefault();
        if (body is null)
            return MissingBodyResult(failures);

        failures.AddRange(validator.Validate(body));

        return failures.Count > 0 ? UnprocessableEntity(failures) : await next(context);
    }

    private static IResult MissingBodyResult(IReadOnlyList<ValidationFailure> headerFailures)
    {
        var errors = headerFailures
            .Select(f => new { pointer = f.Pointer, message = f.Message })
            .ToArray();

        return Results.Problem(
            title: "Unprocessable payload.",
            detail: "The request body is missing, malformed, or contains unknown fields.",
            statusCode: StatusCodes.Status422UnprocessableEntity,
            extensions: new Dictionary<string, object?> { ["errors"] = errors });
    }

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
