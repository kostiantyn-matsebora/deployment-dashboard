using Dashboard.Shared.Contracts;

namespace Dashboard.Control.Validation;

internal interface IComponentEventValidator
{
    /// <summary>Validates a component-event body against DataAnnotations + the state enum rule.</summary>
    IReadOnlyList<ValidationFailure> Validate(ComponentEventIngest body);
}
