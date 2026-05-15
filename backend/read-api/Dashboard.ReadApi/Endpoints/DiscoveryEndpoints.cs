using Dashboard.Shared.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// /api/environments and /api/services — derived from stored data per
/// SAD FR-09 and §7 API Contract. The lists are intentionally not
/// hardcoded so any new environment / service appears automatically once
/// its first deployment event is ingested.
/// </summary>
public static class DiscoveryEndpoints
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/environments", async (DashboardDbContext db, CancellationToken ct) =>
        {
            var envs = await db.Deployments
                .AsNoTracking()
                .Select(e => e.Environment)
                .Distinct()
                .OrderBy(e => e)
                .ToListAsync(ct);
            return Results.Ok(envs);
        });

        app.MapGet("/api/services", async (DashboardDbContext db, CancellationToken ct) =>
        {
            var services = await db.Deployments
                .AsNoTracking()
                .Select(e => e.Service)
                .Distinct()
                .OrderBy(s => s)
                .ToListAsync(ct);
            return Results.Ok(services);
        });
    }
}
