using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.Ingest;

public interface IIngestClient
{
    Task PostAsync(DeploymentEventIngest ev, string adapterId, CancellationToken ct);
}
