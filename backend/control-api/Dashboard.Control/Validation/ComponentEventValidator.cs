using System.ComponentModel.DataAnnotations;
using Dashboard.Shared.Contracts;

namespace Dashboard.Control.Validation;

/// <summary>
/// Validates a <see cref="ComponentEventIngest"/> body using DataAnnotations
/// plus the <c>state</c> enum rule that DataAnnotations cannot express.
/// Mirrors <c>Dashboard.Write.Validation.IngestValidator</c>.
/// </summary>
internal sealed class ComponentEventValidator : IComponentEventValidator
{
    public IReadOnlyList<ValidationFailure> Validate(ComponentEventIngest body)
    {
        var failures = new List<ValidationFailure>();
        CollectAnnotationFailures(body, failures);
        CollectBusinessRuleFailures(body, failures);
        return failures;
    }

    private static void CollectAnnotationFailures(ComponentEventIngest body, List<ValidationFailure> failures)
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

    private static void CollectBusinessRuleFailures(ComponentEventIngest body, List<ValidationFailure> failures)
    {
        if (!ComponentState.IsValid(body.State))
            failures.Add(new ValidationFailure(
                "/state",
                $"Must be one of: {string.Join(", ", ComponentState.All)}."));
    }

    private static string ToJsonPointer(string memberName) => memberName switch
    {
        nameof(ComponentEventIngest.EventType) => "/event_type",
        nameof(ComponentEventIngest.State) => "/state",
        nameof(ComponentEventIngest.Detail) => "/detail",
        nameof(ComponentEventIngest.OccurredAt) => "/occurred_at",
        nameof(ComponentEventIngest.Payload) => "/payload",
        _ => $"/{memberName}",
    };
}
