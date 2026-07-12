using Dashboard.Shared.Contracts;

namespace Dashboard.Write.Services;

internal interface IDeploymentIngestService
{
    Task<IngestResult> IngestAsync(
        DeploymentEventIngest body,
        string? progressReporter,
        CancellationToken ct);
}
