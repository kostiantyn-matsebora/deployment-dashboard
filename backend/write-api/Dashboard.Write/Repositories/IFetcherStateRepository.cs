using Dashboard.Shared.Entities;

namespace Dashboard.Write.Repositories;

internal interface IFetcherStateRepository
{
    /// <summary>Returns the stored cursor for the given adapter, or <c>null</c> if none has been stored yet.</summary>
    Task<FetcherState?> GetByAdapterAsync(string adapter, CancellationToken ct);

    /// <summary>Inserts or updates the cursor for the given adapter (latest write wins).</summary>
    Task UpsertAsync(string adapter, string cursor, CancellationToken ct);
}
