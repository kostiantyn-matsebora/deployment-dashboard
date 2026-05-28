using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Write.Notifiers;

/// <summary>
/// Issues a PostgreSQL <c>NOTIFY deployment_events</c> with the new row id as payload.
/// Subscribers (SSE broadcaster, Phase 5) receive the id and fan-out to connected clients.
/// </summary>
internal sealed class PostgresDeploymentNotifier(DashboardDbContext dbContext) : IDeploymentNotifier
{
    public async Task NotifyAsync(Guid eventId, CancellationToken ct = default)
    {
        var id = eventId.ToString();
        await dbContext.Database.ExecuteSqlAsync(
            $"SELECT pg_notify('deployment_events', {id})", ct);
    }
}
