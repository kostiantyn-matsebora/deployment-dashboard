using Dashboard.Control.Models;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Repositories;

internal interface IComponentEventRepository
{
    /// <summary>Appends one component-event row.</summary>
    Task InsertAsync(ComponentEvent entity, CancellationToken ct);

    /// <summary>Returns the component event with the given surrogate id, or <c>null</c> if not found.</summary>
    Task<ComponentEvent?> GetByIdAsync(Guid id, CancellationToken ct);

    /// <summary>
    /// Returns all component events with <c>id &gt; lastId</c>, ordered by <c>id</c> ascending.
    /// Used for SSE <c>Last-Event-ID</c> resume replay (D3: the row <c>id</c> is the stream cursor).
    /// </summary>
    Task<IReadOnlyList<ComponentEventRecord>> GetSinceAsync(Guid lastId, CancellationToken ct);
}
