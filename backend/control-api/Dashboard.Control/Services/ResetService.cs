using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Services;

internal sealed class ResetService(DashboardDbContext db) : IResetService
{
    public async Task ResetAsync(CancellationToken ct = default)
    {
        await db.DeploymentEvents.ExecuteDeleteAsync(ct);
        await db.FetcherStates.ExecuteDeleteAsync(ct);
    }
}
