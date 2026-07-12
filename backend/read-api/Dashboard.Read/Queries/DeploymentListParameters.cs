using Microsoft.AspNetCore.Mvc;

namespace Dashboard.Read.Queries;

/// <summary>
/// Minimal API parameter object for <c>GET /api/deployments</c>.
/// Bound via <c>[AsParameters]</c> to collapse the per-filter <see cref="IFromQuery"/> attributes
/// into a single handler argument, keeping the handler parameter count under the S107 threshold.
/// </summary>
internal sealed record DeploymentListParameters(
    [FromQuery] string? Service,
    [FromQuery] string? Environment,
    [FromQuery] string? Status,
    [FromQuery(Name = "deployment_id")] string? DeploymentId,
    [FromQuery] DateTimeOffset? Since,
    [FromQuery] DateTimeOffset? Until,
    [FromQuery] string? Q,
    [FromQuery] string? Cursor,
    [FromQuery] int? Limit);
