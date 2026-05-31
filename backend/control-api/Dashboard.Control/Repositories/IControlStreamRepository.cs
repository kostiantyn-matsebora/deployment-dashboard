using Dashboard.Shared.Entities;

namespace Dashboard.Control.Repositories;

internal interface IControlStreamRepository
{
    /// <summary>Appends one control-stream row (the persisted form of an emitted control event).</summary>
    Task InsertAsync(ControlStreamEvent entity, CancellationToken ct);

    /// <summary>
    /// Replays persisted control events with <c>id &gt; lastId</c> (insert order, D3) for
    /// <c>Last-Event-ID</c> resume, bounded by the 2 h retention window. Optional component filter
    /// matches <c>component == value OR component == "*"</c>.
    /// </summary>
    Task<IReadOnlyList<ControlStreamEvent>> GetSinceAsync(
        Guid lastId, string? component, CancellationToken ct);
}
