using Dashboard.Control.Models;
using Dashboard.Control.Queries;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Repositories;

internal interface IComponentEventRepository
{
    /// <summary>Appends one component-event row.</summary>
    Task InsertAsync(ComponentEvent entity, CancellationToken ct);

    /// <summary>Lists component events newest-first (<c>received_at DESC, id DESC</c>) with a cursor page.</summary>
    Task<(IReadOnlyList<ComponentEventRecord> Items, string? NextCursor)> ListAsync(
        ComponentEventListQuery query, CancellationToken ct);
}
