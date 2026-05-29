using Dashboard.Shared.Entities;

namespace Dashboard.Read.Models;

/// <summary>
/// Response body for <c>GET /api/deployments</c>.
/// Serialised with the global snake_case policy: <c>items</c>, <c>next_cursor</c>.
/// </summary>
internal sealed record DeploymentEventPage(
    IReadOnlyList<DeploymentEvent> Items,
    string? NextCursor);
