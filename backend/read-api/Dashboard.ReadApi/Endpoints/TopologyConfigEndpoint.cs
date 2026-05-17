using Dashboard.Shared.Dto;
using Dashboard.Shared.Topology;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// <c>GET /api/config/topology</c> — Read surface (SAD §7 API Contract,
/// WBS 1.2.7). Unauthenticated mirror of the active topology config so the
/// SPA's correlation-attribute picker can label the "system default" entry.
///
/// <para>The matching <c>PATCH</c> endpoint lives on the Write surface
/// (<see cref="Dashboard.WriteApi.WriteApiEndpoints.MapWriteEndpoints"/>)
/// because it mutates server-side state and must be auth-gated by the
/// same <c>X-Api-Key</c> filter that protects <c>POST /api/deployments</c>
/// (SAD §8 + WBS 1.2.7).</para>
///
/// <para>The Phase-1 SAD revision removed the <c>AllowUserOverride</c>
/// kill-switch — there is no <c>403 Forbidden</c> branch any more, because
/// the SPA cannot write to the API at all (it never carries the
/// <c>X-Api-Key</c>).</para>
/// </summary>
public static class TopologyConfigEndpoint
{
    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/config/topology",
            async (TopologyConfigStore store, CancellationToken ct) =>
                Results.Ok(await store.GetAsync(ct)))
        .WithName("GetTopologyConfig")
        .WithTags("Read")
        .WithSummary("Active topology / correlation configuration")
        .WithDescription(
            "Unauthenticated mirror of the active topology config so the SPA's " +
            "correlation-attribute picker can label the 'system default' entry. The " +
            "matching PATCH endpoint lives on the Write surface (X-Api-Key required).")
        .Produces<TopologyConfigDto>(StatusCodes.Status200OK);
    }
}
