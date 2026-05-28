using System.ComponentModel.DataAnnotations;
using Dashboard.Shared.Contracts;

namespace Dashboard.Write.Validation;

/// <summary>
/// Validates a <see cref="DeploymentEventIngest"/> body using DataAnnotations
/// and business rules that DataAnnotations cannot express.
/// </summary>
internal sealed class IngestValidator : IIngestValidator
{
    public IReadOnlyList<ValidationFailure> Validate(DeploymentEventIngest body)
    {
        var failures = new List<ValidationFailure>();
        CollectAnnotationFailures(body, failures);
        CollectBusinessRuleFailures(body, failures);
        return failures;
    }

    private static void CollectAnnotationFailures(DeploymentEventIngest body, List<ValidationFailure> failures)
    {
        var context = new ValidationContext(body);
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(body, context, results, validateAllProperties: true);

        foreach (var result in results)
        {
            var pointer = result.MemberNames.FirstOrDefault() is { } member
                ? ToJsonPointer(member)
                : "/";
            failures.Add(new ValidationFailure(pointer, result.ErrorMessage ?? "Invalid value."));
        }
    }

    private static void CollectBusinessRuleFailures(DeploymentEventIngest body, List<ValidationFailure> failures)
    {
        if (body.Status is not null && !DeploymentStatus.IsValid(body.Status))
            failures.Add(new ValidationFailure(
                "/status",
                $"Must be one of: {string.Join(", ", DeploymentStatus.All)}."));

        if (body.ParentDeployments?.Length > 32)
            failures.Add(new ValidationFailure(
                "/parent_deployments",
                "Must contain at most 32 items."));
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
