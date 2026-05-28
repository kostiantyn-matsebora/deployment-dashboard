using System.ComponentModel.DataAnnotations;
using Dashboard.Shared.Contracts;
using Microsoft.AspNetCore.Http;

namespace Dashboard.Write.Filters;

/// <summary>
/// Endpoint filter that validates <see cref="DeploymentEventIngest"/> bodies.
/// DataAnnotations + business rules → <c>422 application/problem+json</c> with
/// an <c>errors[]</c> array of <c>{ pointer, message }</c> objects (RFC 9457 extension).
/// </summary>
internal sealed class ValidationEndpointFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var body = context.Arguments.OfType<DeploymentEventIngest>().FirstOrDefault();
        if (body is null)
        {
            // Body binding failed before the filter ran (missing required fields,
            // unknown fields, or malformed JSON). Surface as 422.
            return Results.Problem(
                title: "Unprocessable payload.",
                detail: "The request body is missing, malformed, or contains unknown fields.",
                statusCode: StatusCodes.Status422UnprocessableEntity,
                extensions: new Dictionary<string, object?> { ["errors"] = Array.Empty<object>() });
        }

        var failures = Validate(body);
        if (failures.Count > 0)
            return UnprocessableEntity(failures);

        return await next(context);
    }

    internal static List<ValidationFailure> Validate(DeploymentEventIngest body)
    {
        var failures = new List<ValidationFailure>();

        // DataAnnotations (Required, MinLength, MaxLength, Range, …)
        var validationContext = new ValidationContext(body);
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(body, validationContext, results, validateAllProperties: true);

        foreach (var result in results)
        {
            var pointer = result.MemberNames.FirstOrDefault() is { } member
                ? ToJsonPointer(member)
                : "/";
            failures.Add(new ValidationFailure(pointer, result.ErrorMessage ?? "Invalid value."));
        }

        // Business rules not expressible via DataAnnotations.
        if (body.Status is not null && !DeploymentStatus.IsValid(body.Status))
            failures.Add(new ValidationFailure("/status",
                $"Must be one of: {string.Join(", ", DeploymentStatus.All)}."));

        if (body.ParentDeployments?.Length > 32)
            failures.Add(new ValidationFailure("/parent_deployments",
                "Must contain at most 32 items."));

        return failures;
    }

    private static IResult UnprocessableEntity(IEnumerable<ValidationFailure> failures)
    {
        var errors = failures
            .Select(f => new { pointer = f.Pointer, message = f.Message })
            .ToArray();

        return Results.Problem(
            title: "One or more validation errors occurred.",
            statusCode: StatusCodes.Status422UnprocessableEntity,
            extensions: new Dictionary<string, object?> { ["errors"] = errors });
    }

    private static string ToJsonPointer(string memberName) => memberName switch
    {
        nameof(DeploymentEventIngest.DeploymentId) => "/deployment_id",
        nameof(DeploymentEventIngest.Service) => "/service",
        nameof(DeploymentEventIngest.Environment) => "/environment",
        nameof(DeploymentEventIngest.Version) => "/version",
        nameof(DeploymentEventIngest.Status) => "/status",
        nameof(DeploymentEventIngest.HappenedAt) => "/happened_at",
        nameof(DeploymentEventIngest.RunUrl) => "/run_url",
        nameof(DeploymentEventIngest.RunNumber) => "/run_number",
        nameof(DeploymentEventIngest.Actor) => "/actor",
        nameof(DeploymentEventIngest.Ref) => "/ref",
        nameof(DeploymentEventIngest.Sha) => "/sha",
        nameof(DeploymentEventIngest.ParentDeployments) => "/parent_deployments",
        _ => $"/{memberName}",
    };
}

internal sealed record ValidationFailure(string Pointer, string Message);
