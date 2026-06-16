using Dashboard.Control;
using Dashboard.Control.Sse;
using Dashboard.Read;
using Dashboard.Shared.Data;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Api.Endpoints;

/// <summary>
/// Operational probes (<c>/healthz</c>, <c>/readyz</c>) and meta endpoints (<c>/api/version</c>)
/// — kept out of the composition root so <c>Program.cs</c> stays a flat list of registrations
/// and mappings (one altitude).
/// </summary>
internal static class OpsEndpoints
{
    private const string VersionFallback = "0.0.0-dev";

    internal static IEndpointRouteBuilder MapOpsEndpoints(this IEndpointRouteBuilder app)
    {
        // Liveness probe: process is up. Returns {"status":"ok"} per the OpenAPI contract.
        app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }))
           .WithTags("ops")
           .WithSummary("Liveness probe");

        // Readiness probe: DB reachable + ALL FOUR LISTEN channels attached (D10, D12, §7 ch.4).
        // Returns 200 ready/degraded or 503 when the DB is not reachable.
        app.MapGet("/readyz", HandleReadyzAsync)
           .WithTags("ops")
           .WithSummary("Readiness probe");

        // Deployed build version — unauthenticated; reads DASHBOARD_VERSION env var (§5 meta).
        app.MapGet("/api/version", (IConfiguration config) =>
            {
                var version = config["DASHBOARD_VERSION"];
                return Results.Ok(new { version = string.IsNullOrEmpty(version) ? VersionFallback : version });
            })
           .WithTags("meta")
           .WithSummary("Deployed build version.");

        return app;
    }

    private static async Task<IResult> HandleReadyzAsync(
        DashboardDbContext db,
        IReadinessIndicator deploymentReadiness,
        IControlReadinessIndicator controlReadiness,
        IAckReadinessIndicator ackReadiness,
        IComponentEventReadinessIndicator componentEventReadiness,
        CancellationToken ct)
    {
        var dbOk = await IsDatabaseReachableAsync(db, ct);
        var deploymentListenOk = deploymentReadiness.IsListenerConnected;
        var controlListenOk = controlReadiness.IsControlListenerConnected;
        var ackListenOk = ackReadiness.IsAckListenerConnected;
        var componentEventListenOk = componentEventReadiness.IsComponentEventListenerConnected;

        var checks = new Dictionary<string, string>
        {
            ["db"] = Flag(dbOk),
            ["listen_deployment"] = Flag(deploymentListenOk),
            ["listen_control"] = Flag(controlListenOk),
            ["listen_acks"] = Flag(ackListenOk),
            ["listen_component_events"] = Flag(componentEventListenOk),
        };

        if (!dbOk)
            return Results.Problem(
                title: "Service is not ready.",
                detail: "Database is not reachable.",
                statusCode: StatusCodes.Status503ServiceUnavailable,
                extensions: new Dictionary<string, object?> { ["checks"] = checks });

        // All four LISTEN channels must be attached for full readiness (D10, D12, §7 ch.4); any missing → degraded.
        var status = deploymentListenOk && controlListenOk && ackListenOk && componentEventListenOk ? "ready" : "degraded";
        return Results.Ok(new { status, checks });
    }

    private static async Task<bool> IsDatabaseReachableAsync(DashboardDbContext db, CancellationToken ct)
    {
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string Flag(bool ok) => ok ? "ok" : "fail";
}
