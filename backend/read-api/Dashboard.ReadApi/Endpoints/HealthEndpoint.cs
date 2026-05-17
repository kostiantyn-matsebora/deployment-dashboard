using Dashboard.Shared.Persistence;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// /health — liveness + DB ping. SAD §7 specifies {"status": "ok"}.
/// </summary>
public static class HealthEndpoint
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/health", async (DashboardDbContext db, CancellationToken ct) =>
        {
            // Round-trips to the DB to confirm the connection pool is
            // healthy. If this throws, ASP.NET returns 500 — which is the
            // signal we want orchestrators to react to.
            await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return Results.Ok(new { status = "ok" });
        })
        .WithName("GetHealth")
        .WithTags("Read")
        .WithSummary("Liveness probe with DB round-trip")
        .WithDescription(
            "Returns {\"status\":\"ok\"} when the API can reach Postgres. A failed " +
            "round-trip surfaces as 500 — the signal orchestrators react to. " +
            "Unauthenticated (SAD §7).")
        .Produces(StatusCodes.Status200OK)
        .ProducesProblem(StatusCodes.Status500InternalServerError);
    }
}
