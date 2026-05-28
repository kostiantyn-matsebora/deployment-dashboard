using Dashboard.Shared.Contracts;

namespace Dashboard.Write.Validation;

internal interface IIngestValidator
{
    IReadOnlyList<ValidationFailure> Validate(DeploymentEventIngest body);
}
