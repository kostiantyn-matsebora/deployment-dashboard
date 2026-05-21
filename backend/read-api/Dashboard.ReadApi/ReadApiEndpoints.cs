using Dashboard.ReadApi.Endpoints;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.ReadApi;

/// <summary>
/// Endpoint registration for the Read surface (SAD §7 "Backend module
/// architecture" + WBS 1.2). The host composition root calls
/// <see cref="MapReadEndpoints"/> once, on the unauthenticated route group
/// — per SAD §8, the Read surface has no API-key requirement.
///
/// <para>The Read surface owns:</para>
/// <list type="bullet">
///   <item><c>GET /api/deployments</c>, single-slot, history.</item>
///   <item><c>GET /api/environments</c>, <c>GET /api/services</c>
///   (discovery).</item>
///   <item><c>GET /health</c> (liveness + DB ping).</item>
///   <item><c>GET /api/stream</c> (SSE; one
///   <see cref="Dashboard.Shared.Realtime.SlotUpdateBroker"/> subscription
///   per connection).</item>
///   <item><c>GET /api/config/topology</c> (mirror of server-side
///   correlation config — SPA-readable, no auth).</item>
/// </list>
///
/// <para>The matching <c>PATCH /api/config/topology</c> endpoint lives on
/// the Write surface (<c>WriteApiEndpoints.MapWriteEndpoints</c>) because
/// it mutates server-side state and must be auth-gated (SAD §8 +
/// WBS 1.2.7).</para>
/// </summary>
public static class ReadApiEndpoints
{
    public static IEndpointRouteBuilder MapReadEndpoints(this IEndpointRouteBuilder builder)
    {
        DeploymentEndpoints.Map(builder);
        DiscoveryEndpoints.Map(builder);
        HealthEndpoint.Map(builder);
        StreamEndpoint.Map(builder);
        TopologyConfigEndpoint.Map(builder);
        FetcherUsageEndpoint.Map(builder);
        return builder;
    }
}
