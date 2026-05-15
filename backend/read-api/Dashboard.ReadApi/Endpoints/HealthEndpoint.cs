using Dashboard.Shared.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// /health — liveness + DB ping. SAD §7 specifies {"status": "ok"}.
/// </summary>
public static class HealthEndpoint
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/health", async (DashboardDbContext db, CancellationToken ct) =>
        {
            // Round-trips to the DB to confirm the connection pool is
            // healthy. If this throws, ASP.NET returns 500 — which is the
            // signal we want orchestrators to react to.
            await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return Results.Ok(new { status = "ok" });
        });
    }
}
