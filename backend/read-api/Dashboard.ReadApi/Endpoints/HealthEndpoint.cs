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
        .WithSummary("Liveness probe for uptime monitoring")
        .WithDescription(
            "Cheap liveness check suitable for uptime monitors and orchestrator health probes. " +
            "Performs a trivial round-trip to the database.\n\n" +
            "**Returns** `{\"status\":\"ok\"}` on success.\n\n" +
            "**Authentication.** None required. No caching headers; safe to poll at any " +
            "reasonable interval.\n\n" +
            "**Errors:**\n" +
            "- `500 Internal Server Error` — the database round-trip failed. This is the " +
            "signal monitors should react to.")
        .Produces(StatusCodes.Status200OK, contentType: "application/json")
        .ProducesProblem(StatusCodes.Status500InternalServerError);
    }
}
