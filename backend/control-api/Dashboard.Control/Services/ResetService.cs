using Dashboard.Control.Notifiers;
using Dashboard.Control.Repositories;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Services;

internal sealed class ResetService(
    DashboardDbContext db,
    IControlStreamRepository controlStream,
    IControlEventNotifier notifier) : IResetService
{
    public async Task ResetAsync(CancellationToken ct = default)
    {
        // Truncate all stored data (spec §5 / openapi resetState): the two durable tables
        // plus the two control-plane tables.
        await db.DeploymentEvents.ExecuteDeleteAsync(ct);
        await db.FetcherStates.ExecuteDeleteAsync(ct);
        await db.ComponentEvents.ExecuteDeleteAsync(ct);
        await db.ControlStreamEvents.ExecuteDeleteAsync(ct);

        // Persist + announce a reset event so connected components reinitialise (§7 ch.2).
        // The row is inserted AFTER the truncation so it survives for Last-Event-ID replay.
        var resetEvent = new ControlStreamEvent
        {
            Id = Guid.CreateVersion7(),
            Type = "reset",
            Component = "*",
            OccurredAt = DateTimeOffset.UtcNow,
        };
        await controlStream.InsertAsync(resetEvent, ct);
        await notifier.NotifyAsync(resetEvent, ct);
    }
}
