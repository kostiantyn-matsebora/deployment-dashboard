using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues <c>NOTIFY component_events</c> with the new row id as payload (id-only, §7 ch.4).
/// The <see cref="Sse.ComponentEventBroadcaster"/> parses the id, fetches the full row, and
/// fans it out — no full JSON in the NOTIFY payload, avoiding the ~8 KiB Postgres limit.
/// Mirrors <c>PostgresDeploymentNotifier</c> from <c>Dashboard.Write</c>.
/// </summary>
internal sealed class PostgresComponentEventNotifier(DashboardDbContext db) : IComponentEventNotifier
{
    public async Task NotifyAsync(Guid eventId, CancellationToken ct = default)
    {
        var id = eventId.ToString();
        await db.Database.ExecuteSqlAsync($"SELECT pg_notify('component_events', {id})", ct);
    }
}
