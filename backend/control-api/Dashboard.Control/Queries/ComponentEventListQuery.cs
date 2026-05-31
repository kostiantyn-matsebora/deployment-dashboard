namespace Dashboard.Control.Queries;

/// <summary>
/// Validated query parameters for <c>GET /api/control/events</c>.
/// Filters are optional (null = no filter). <see cref="Limit"/> is pre-clamped to [1, 200].
/// </summary>
internal sealed record ComponentEventListQuery(
    string? ComponentId,
    string? EventType,
    DateTimeOffset? Since,
    string? Cursor,
    int Limit);
