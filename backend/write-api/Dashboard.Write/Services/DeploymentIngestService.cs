using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;

namespace Dashboard.Write.Services;

/// <summary>
/// Application service that persists one ingest body as a new <see cref="DeploymentEvent"/>
/// row and triggers the post-commit notification.
/// </summary>
internal sealed class DeploymentIngestService(
    DashboardDbContext dbContext,
    IDeploymentNotifier notifier) : IDeploymentIngestService
{
    public async Task<DeploymentEvent> IngestAsync(
        DeploymentEventIngest body,
        string? progressReporter,
        CancellationToken ct)
    {
        var ev = MapToEntity(body, progressReporter);
        dbContext.DeploymentEvents.Add(ev);
        await dbContext.SaveChangesAsync(ct);
        await notifier.NotifyAsync(ev.Id, ct);
        return ev;
    }

    private static DeploymentEvent MapToEntity(DeploymentEventIngest body, string? progressReporter) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = body.DeploymentId,
            Service = body.Service,
            Environment = body.Environment,
            Version = body.Version,
            Status = body.Status,
            HappenedAt = body.HappenedAt,
            RunUrl = body.RunUrl,
            RunNumber = body.RunNumber,
            Actor = body.Actor,
            Ref = body.Ref,
            Sha = body.Sha,
            ParentDeployments = body.ParentDeployments,
            ProgressReporter = progressReporter,
        };
}
