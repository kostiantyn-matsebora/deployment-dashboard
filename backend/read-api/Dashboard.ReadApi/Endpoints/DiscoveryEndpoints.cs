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
        })
        .WithName("GetEnvironments")
        .WithTags("Read")
        .WithSummary("Distinct environments ever ingested")
        .WithDescription(
            "Returns the sorted list of environment names derived from stored data " +
            "(FR-09). A new environment appears the first time a deployment event for " +
            "it is ingested — there is no static list to maintain.")
        .Produces<string[]>(StatusCodes.Status200OK);

        app.MapGet("/api/services", async (DashboardDbContext db, CancellationToken ct) =>
        {
            var services = await db.Deployments
                .AsNoTracking()
                .Select(e => e.Service)
                .Distinct()
                .OrderBy(s => s)
                .ToListAsync(ct);
            return Results.Ok(services);
        })
        .WithName("GetServices")
        .WithTags("Read")
        .WithSummary("Distinct services ever ingested")
        .WithDescription(
            "Returns the sorted list of service names derived from stored data (FR-09). " +
            "Same auto-discovery rule as GET /api/environments.")
        .Produces<string[]>(StatusCodes.Status200OK);
    }
}
