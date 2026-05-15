using Dashboard.Shared.Dto;
using Dashboard.Shared.Security;
using Dashboard.Shared.Topology;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// <c>GET /api/config/topology</c> and <c>PATCH /api/config/topology</c>
/// (SAD §7 API Contract).
///
/// <list type="bullet">
///   <item><c>GET</c> is unauthenticated — the SPA needs it to label the
///   "system default" entry in its picker.</item>
///   <item><c>PATCH</c> is <strong>admin / CI / ops tooling only — not
///   invoked by the SPA</strong> (SAD §7). Auth-gated by the same
///   <c>X-Api-Key</c> middleware as <c>POST /api/deployments</c>.</item>
///   <item>Returns <c>400 Bad Request</c> when the body contains a
///   correlation attribute not in the SAD-allowed set.</item>
/// </list>
///
/// <para>The Phase-1 SAD revision removed the <c>AllowUserOverride</c>
/// kill-switch — there is no <c>403 Forbidden</c> branch any more, because
/// the SPA cannot write to the API at all (it never carries the
/// <c>X-Api-Key</c>). PATCH stays in the API for admin / CI / ops tooling.</para>
/// </summary>
public static class TopologyConfigEndpoint
{
    public static void Map(WebApplication app)
    {
        // GET — unauthenticated mirror of the active config.
        app.MapGet("/api/config/topology",
            async (TopologyConfigStore store, CancellationToken ct) =>
                Results.Ok(await store.GetAsync(ct)));

        // PATCH — auth-gated by the same X-Api-Key middleware as
        // POST /api/deployments (SAD §7). UseWhen branches the pipeline
        // on (method, path) so the GET above stays unauthenticated.
        var apiKeyOptions = app.Services.GetRequiredService<ApiKeyOptions>();
        app.UseWhen(
            ctx => ctx.Request.Path.Equals("/api/config/topology", StringComparison.OrdinalIgnoreCase)
                   && HttpMethods.IsPatch(ctx.Request.Method),
            sub => sub.UseApiKeyAuth(apiKeyOptions));

        app.MapPatch("/api/config/topology",
            async (TopologyConfigPatch body, TopologyConfigStore store, CancellationToken ct) =>
        {
            try
            {
                var updated = await store.PatchAsync(body, ct);
                return Results.Ok(updated);
            }
            catch (InvalidTopologyAttributeException ex)
            {
                // SAD §7 PATCH body table: "Rejected with 400 if not in this set
                // or if `id` is supplied".
                return Results.BadRequest(new
                {
                    error = "invalid_correlation_attribute",
                    message = ex.Message,
                    attribute = ex.Attribute,
                });
            }
        });
    }
}
