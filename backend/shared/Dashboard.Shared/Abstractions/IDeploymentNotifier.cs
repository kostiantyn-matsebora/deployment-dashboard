namespace Dashboard.Shared.Abstractions;

/// <summary>
/// Notifies subscribers that a new deployment event has been persisted.
/// Production implementation issues a PostgreSQL <c>NOTIFY deployment_events</c>;
/// test implementations are no-ops.
/// </summary>
public interface IDeploymentNotifier
{
    Task NotifyAsync(Guid eventId, CancellationToken ct = default);
}
