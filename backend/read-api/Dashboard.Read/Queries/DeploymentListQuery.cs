namespace Dashboard.Read.Queries;

/// <summary>
/// Validated query parameters for the <c>GET /api/deployments</c> listing endpoint.
/// Filters are all optional (null = no filter). <see cref="Limit"/> is pre-clamped to [1, 500].
/// </summary>
internal sealed record DeploymentListQuery(
    string? Service,
    string? Environment,
    string? Status,
    string? DeploymentId,
    DateTimeOffset? Since,
    DateTimeOffset? Until,
    string? Cursor,
    int Limit);
