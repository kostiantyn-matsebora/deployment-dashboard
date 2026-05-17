using Dashboard.Shared.Dto;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Queries;
using Dashboard.Shared.Topology;
using Dashboard.Shared.Validation;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// Matrix, single-slot, and history endpoints (SAD §7 API Contract).
///
/// <para><c>GET /api/deployments</c> accepts an optional
/// <c>correlationAttribute</c> query parameter (SAD §7 "GET /api/deployments
/// — query parameters"): a per-request hint for the correlation-fallback
/// pass of the topology builder. Allowed values: <c>version</c>, <c>ref</c>,
/// <c>sha</c>, <c>actor</c>, <c>run</c>, <c>ago</c>. <c>id</c> is disallowed.
/// Invalid value → <c>400 Bad Request</c>. Precedence:
/// <c>PerServiceOverrides[svc] &gt; query-param &gt; server default</c>.</para>
///
/// <para>The single-slot and history endpoints accept the same query
/// parameter for shape consistency, but ignore it because they do not return
/// topology (SAD §7: "<c>GET /api/deployments/{service}/{environment}</c>
/// and <c>.../history</c> accept it but ignore it — these endpoints do not
/// return topology").</para>
/// </summary>
public static class DeploymentEndpoints
{
    /// <summary>Query-parameter name for the per-request correlation override.</summary>
    public const string CorrelationAttributeQueryName = "correlationAttribute";

    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/deployments", async (
            HttpContext httpContext,
            DashboardDbContext db,
            TopologyBuilder topologyBuilder,
            TopologyConfigStore configStore,
            CancellationToken ct) =>
        {
            if (!TryReadCorrelationAttribute(httpContext, out var requestOverride, out var problem))
            {
                return problem;
            }

            var matrix = await MatrixQuery.BuildAsync(
                db,
                topologyBuilder,
                service => configStore.ResolveAttributeForServiceAsync(service, requestOverride, ct),
                ct);
            return Results.Ok(matrix);
        })
        .WithName("GetMatrix")
        .WithTags("Read")
        .WithSummary("Full service x environment matrix")
        .WithDescription(
            "Returns the entire deployment matrix as a JSON object keyed by service name. " +
            "Each entry carries the per-environment slot state (current / lastSuccessful / " +
            "previousFailed) plus the derived topology edges for that service.\n\n" +
            "The optional `correlationAttribute` query parameter is a per-request hint for " +
            "the topology builder's correlation-fallback pass (used for services that did " +
            "not push explicit parent_deployments at ingest time). Allowed values: " +
            "`version`, `ref`, `sha`, `actor`, `run`, `ago`. Precedence: per-service " +
            "override beats the query parameter, which beats the server default. An " +
            "out-of-range value returns 400 Bad Request. Unauthenticated.")
        .Produces<IDictionary<string, ServiceMatrix>>(StatusCodes.Status200OK, contentType: "application/json")
        .ProducesProblem(StatusCodes.Status400BadRequest);

        app.MapGet("/api/deployments/{service}/{environment}",
            async (string service,
                   string environment,
                   HttpContext httpContext,
                   DashboardDbContext db,
                   TopologyBuilder topologyBuilder,
                   TopologyConfigStore configStore,
                   CancellationToken ct) =>
        {
            // The slot endpoint does not return topology (SAD §7), but we
            // still validate the query parameter so an invalid request shape
            // surfaces with a consistent 400 across endpoints. The validated
            // value is then ignored for derivation.
            if (!TryReadCorrelationAttribute(httpContext, out var requestOverride, out var problem))
            {
                return problem;
            }

            // Defer to MatrixQuery so the slot-level derivation
            // (lastSuccessful, previousFailed) matches the matrix view
            // exactly. Filtering at the DB keeps the in-memory pass small.
            var attribute = await configStore.ResolveAttributeForServiceAsync(service, requestOverride, ct);
            var (slot, _) = await MatrixQuery.BuildSlotAsync(
                db, service, environment, topologyBuilder, attribute, ct);

            // CR-0008: 4xx body is RFC 7807 ProblemDetails (Read API too).
            return slot is null
                ? ProblemResults.NotFound(
                    title: "Slot not found",
                    detail: $"No deployment history exists for service '{service}' and environment '{environment}'.",
                    errorSlug: "slot_not_found")
                : Results.Ok(slot);
        })
        .WithName("GetSlot")
        .WithTags("Read")
        .WithSummary("Single-slot view for a (service, environment) pair")
        .WithDescription(
            "Returns the same per-slot block (current / lastSuccessful / previousFailed) " +
            "that the full matrix endpoint would emit for this pair — useful for clients " +
            "that only care about one tile.\n\n" +
            "The optional `correlationAttribute` query parameter is accepted for " +
            "consistency with the matrix endpoint but ignored here (this endpoint does " +
            "not return topology). An out-of-range value still returns 400 Bad Request. " +
            "404 Not Found when the slot has no deployment history. Unauthenticated.")
        .Produces<MatrixSlot>(StatusCodes.Status200OK, contentType: "application/json")
        .ProducesProblem(StatusCodes.Status400BadRequest)
        .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/deployments/{service}/{environment}/history",
            async (string service, string environment, int? limit, DashboardDbContext db, CancellationToken ct) =>
        {
            // SAD §7 API Contract: ?limit=50 default; 404 when no history.
            // We cap at 1000 defensively so a misconfigured client cannot
            // pull the entire table in one round-trip.
            var n = limit is null or <= 0 ? 50 : Math.Min(limit.Value, 1000);

            var events = await db.Deployments
                .AsNoTracking()
                .Where(e => e.Service == service && e.Environment == environment)
                .OrderByDescending(e => e.DeployedAt)
                .ThenByDescending(e => e.Id)
                .Take(n)
                .ToListAsync(ct);

            if (events.Count == 0)
            {
                return ProblemResults.NotFound(
                    title: "History not found",
                    detail: $"No deployment history exists for service '{service}' and environment '{environment}'.",
                    errorSlug: "history_not_found");
            }

            var dto = events.Select(DeploymentEventResponse.FromEntity).ToArray();
            return Results.Ok(dto);
        })
        .WithName("GetSlotHistory")
        .WithTags("Read")
        .WithSummary("Reverse-chronological deployment history for a slot")
        .WithDescription(
            "Returns the deployment-event history for one (service, environment) pair, " +
            "newest first. The optional `limit` query parameter controls the page size — " +
            "default 50, hard cap 1000 (values above the cap are silently clamped). " +
            "Events are ordered by `deployed_at` descending, with `id` descending as the " +
            "tie-breaker. Returns 404 Not Found when the slot has never been deployed to. " +
            "Unauthenticated.")
        .Produces<DeploymentEventResponse[]>(StatusCodes.Status200OK, contentType: "application/json")
        .ProducesProblem(StatusCodes.Status404NotFound);
    }

    /// <summary>
    /// Read and validate the <c>correlationAttribute</c> query parameter.
    /// Returns <c>true</c> with a non-empty allowed value, <c>true</c> with
    /// <c>null</c> when the parameter is absent, or <c>false</c> with a
    /// populated <paramref name="problem"/> when the supplied value is
    /// outside the SAD-allowed set.
    ///
    /// <para>SAD §7 "GET /api/deployments — query parameters" distinguishes
    /// "Omitted → falls back to the server-side default" from "Invalid value
    /// → 400 Bad Request". An empty value (<c>?correlationAttribute=</c>)
    /// is <em>present-but-invalid</em>, not <em>omitted</em>: the parameter
    /// is in the query string, just empty. Per the SAD's enumeration of
    /// allowed values (none of which is the empty string), this must surface
    /// as 400.</para>
    /// </summary>
    private static bool TryReadCorrelationAttribute(
        HttpContext ctx,
        out string? requestOverride,
        out IResult problem)
    {
        problem = Results.Empty;
        if (!ctx.Request.Query.TryGetValue(CorrelationAttributeQueryName, out var raw))
        {
            // Parameter absent → fall back to server default (SAD precedence).
            requestOverride = null;
            return true;
        }

        // Parameter present (even with empty value) → validate against the
        // SAD-allowed set. `CorrelationAttribute.IsAllowed` returns false for
        // null/empty/whitespace, so the empty case naturally lands in the 400
        // branch below.
        var value = raw.ToString();
        if (!CorrelationAttribute.IsAllowed(value))
        {
            // SAD §7 "GET /api/deployments — query parameters":
            // "Allowed values: version, ref, sha, actor, run, ago. `id` is
            // disallowed. Invalid value → 400 Bad Request."
            requestOverride = null;
            // CR-0008: ProblemDetails body with the existing `error` /
            // `attribute` extras preserved so functional tests pattern-
            // matching on them keep passing.
            problem = ProblemResults.BadRequest(
                title: "Invalid correlationAttribute query parameter",
                detail: $"Correlation attribute '{value}' is not allowed. " +
                        $"Allowed: {string.Join(", ", CorrelationAttribute.Allowed)}.",
                errorSlug: "invalid_correlation_attribute",
                extra: new Dictionary<string, object?> { ["attribute"] = value });
            return false;
        }

        requestOverride = value;
        return true;
    }
}
