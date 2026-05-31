namespace Dashboard.Control.Models;

/// <summary>
/// Response body for <c>GET /api/control/events</c>.
/// Serialised with the global snake_case policy: <c>items</c>, <c>next_cursor</c>.
/// </summary>
public sealed record ComponentEventPage(
    IReadOnlyList<ComponentEventRecord> Items,
    string? NextCursor);
