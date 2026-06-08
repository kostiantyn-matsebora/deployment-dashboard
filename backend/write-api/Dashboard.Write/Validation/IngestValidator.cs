using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json.Serialization;
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

        if (body.ParentDeployments is { Length: > 1 } parents &&
            parents.Length != parents.Distinct(StringComparer.Ordinal).Count())
            failures.Add(new ValidationFailure(
                "/parent_deployments",
                "Items must be unique."));
    }

    // Member name -> JSON pointer, derived from the DTO's [JsonPropertyName] attributes — the
    // single source of truth for wire names. Adding/renaming a property needs no change here;
    // unmapped members fall back to "/{memberName}".
    private static readonly Dictionary<string, string> JsonPointers =
        typeof(DeploymentEventIngest)
            .GetProperties()
            .ToDictionary(
                p => p.Name,
                p => "/" + (p.GetCustomAttribute<JsonPropertyNameAttribute>()?.Name ?? p.Name),
                StringComparer.Ordinal);

    private static string ToJsonPointer(string memberName) =>
        JsonPointers.GetValueOrDefault(memberName, $"/{memberName}");
}
