namespace Dashboard.Read.Models;

/// <summary>
/// Response body for <c>GET /api/services</c> and <c>GET /api/environments</c>.
/// Serialised with the global snake_case policy: <c>items</c>.
/// </summary>
internal sealed record DiscoveryResponse(IReadOnlyList<string> Items);
