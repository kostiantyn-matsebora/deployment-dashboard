using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Notifiers;

/// <summary>Issues <c>NOTIFY reset_state &lt;state&gt;</c> via the EF Core DB facade.</summary>
internal sealed class PostgresResetStateNotifier(DashboardDbContext db) : IResetStateNotifier
{
    public async Task NotifyStateAsync(string state, CancellationToken ct = default) =>
        await db.Database.ExecuteSqlAsync($"SELECT pg_notify('reset_state', {state})", ct);
}
