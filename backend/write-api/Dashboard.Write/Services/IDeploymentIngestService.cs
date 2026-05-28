using Dashboard.Shared.Contracts;
using Dashboard.Shared.Entities;

namespace Dashboard.Write.Services;

internal interface IDeploymentIngestService
{
    Task<DeploymentEvent> IngestAsync(
        DeploymentEventIngest body,
        string? progressReporter,
        CancellationToken ct);
}
