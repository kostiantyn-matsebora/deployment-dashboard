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
            "Returns the sorted, deduplicated list of environment names derived from " +
            "stored deployment events. A new environment appears in the list the first " +
            "time any deployment for it is ingested — there is no separate registration " +
            "step. Unauthenticated.")
        .Produces<string[]>(StatusCodes.Status200OK, contentType: "application/json");

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
            "Returns the sorted, deduplicated list of service names derived from stored " +
            "deployment events. Same auto-discovery rule as GET /api/environments — a new " +
            "service appears on first ingest. Unauthenticated.")
        .Produces<string[]>(StatusCodes.Status200OK, contentType: "application/json");
    }
}
