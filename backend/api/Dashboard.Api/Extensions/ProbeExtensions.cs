using Dashboard.Control;
using Dashboard.Control.Sse;
using Dashboard.Read;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Api.Extensions;

internal static class ProbeExtensions
{
    /// <summary>
    /// Maps the liveness probe at <c>GET /healthz</c>.
    /// Returns <c>{"status":"ok"}</c> whenever the process is up.
    /// </summary>
    internal static WebApplication MapLivenessProbe(this WebApplication app)
    {
        app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }))
           .WithTags("ops")
           .WithSummary("Liveness probe");

        return app;
    }

    /// <summary>
    /// Maps the readiness probe at <c>GET /readyz</c> (D10, D12, §7 ch.4).
    /// <list type="bullet">
    ///   <item><description>503 — database not reachable.</description></item>
    ///   <item><description>200 degraded — DB reachable but one or more LISTEN channels not yet attached.</description></item>
    ///   <item><description>200 ready — DB reachable and all four LISTEN channels attached.</description></item>
    /// </list>
    /// </summary>
    internal static WebApplication MapReadinessProbe(this WebApplication app)
    {
        app.MapGet("/readyz", HandleReadinessAsync)
           .WithTags("ops")
           .WithSummary("Readiness probe");

        return app;
    }

    private static async Task<IResult> HandleReadinessAsync(
        DashboardDbContext db,
        IReadinessIndicator deploymentReadiness,
        IControlReadinessIndicator controlReadiness,
        IAckReadinessIndicator ackReadiness,
        IComponentEventReadinessIndicator componentEventReadiness,
        CancellationToken ct)
    {
        var dbOk = await IsDatabaseReachableAsync(db, ct);

        var checks = BuildChecks(
            dbOk,
            deploymentReadiness.IsListenerConnected,
            controlReadiness.IsControlListenerConnected,
            ackReadiness.IsAckListenerConnected,
            componentEventReadiness.IsComponentEventListenerConnected);

        if (!dbOk)
            return Results.Problem(
                title: "Service is not ready.",
                detail: "Database is not reachable.",
                statusCode: StatusCodes.Status503ServiceUnavailable,
                extensions: new Dictionary<string, object?> { ["checks"] = checks });

        // All four LISTEN channels must be attached for full readiness; any missing → degraded.
        var allListenersConnected =
            deploymentReadiness.IsListenerConnected &&
            controlReadiness.IsControlListenerConnected &&
            ackReadiness.IsAckListenerConnected &&
            componentEventReadiness.IsComponentEventListenerConnected;

        var status = allListenersConnected ? "ready" : "degraded";
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

    private static Dictionary<string, string> BuildChecks(
        bool dbOk,
        bool deploymentListenOk,
        bool controlListenOk,
        bool ackListenOk,
        bool componentEventListenOk) =>
        new()
        {
            ["db"] = dbOk ? "ok" : "fail",
            ["listen_deployment"] = deploymentListenOk ? "ok" : "fail",
            ["listen_control"] = controlListenOk ? "ok" : "fail",
            ["listen_acks"] = ackListenOk ? "ok" : "fail",
            ["listen_component_events"] = componentEventListenOk ? "ok" : "fail",
        };
}
