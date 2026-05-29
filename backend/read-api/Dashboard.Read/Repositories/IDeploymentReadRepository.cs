using Dashboard.Read.Queries;
using Dashboard.Shared.Entities;

namespace Dashboard.Read.Repositories;

internal interface IDeploymentReadRepository
{
    /// <summary>
    /// Returns a cursor-paginated page of events ordered by <c>happened_at DESC, id DESC</c>.
    /// <paramref name="query"/> carries all filters and the pagination state.
    /// </summary>
    Task<(IReadOnlyList<DeploymentEvent> Items, string? NextCursor)> ListAsync(
        DeploymentListQuery query, CancellationToken ct);

    /// <summary>Returns the event with the given surrogate id, or <c>null</c> if not found.</summary>
    Task<DeploymentEvent?> GetByIdAsync(Guid id, CancellationToken ct);

    /// <summary>
    /// Returns one event per <c>(service, environment)</c> slot — the event with the
    /// greatest <c>happened_at</c> (and <c>id</c> as tiebreak). Used to build the Matrix
    /// <c>current</c> column.
    /// </summary>
    Task<IReadOnlyList<DeploymentEvent>> GetCurrentPerSlotAsync(
        string? serviceFilter, CancellationToken ct);

    /// <summary>
    /// Returns the most recent <c>success</c> event per <c>(service, environment)</c> slot.
    /// Used to build the Matrix <c>last_successful</c> column.
    /// </summary>
    Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
        string? serviceFilter, CancellationToken ct);

    /// <summary>Returns all distinct service identifiers, sorted ascending.</summary>
    Task<IReadOnlyList<string>> GetDistinctServicesAsync(CancellationToken ct);

    /// <summary>Returns all distinct environment identifiers, sorted ascending.</summary>
    Task<IReadOnlyList<string>> GetDistinctEnvironmentsAsync(CancellationToken ct);

    /// <summary>
    /// Returns all events with <c>id &gt; lastId</c>, ordered by <c>id</c> ascending.
    /// Used for SSE <c>Last-Event-ID</c> resume replay (D3: the row <c>id</c> is the stream cursor).
    /// </summary>
    Task<IReadOnlyList<DeploymentEvent>> GetSinceAsync(
        Guid lastId, string? serviceFilter, CancellationToken ct);
}
