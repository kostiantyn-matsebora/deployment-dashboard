namespace Dashboard.Control.Services;

/// <summary>Clears all deployment data from the store.</summary>
public interface IResetService
{
    /// <summary>
    /// Deletes all rows from <c>deployment_events</c> and <c>fetcher_state</c>.
    /// Idempotent: safe to call on an already-empty store.
    /// </summary>
    Task ResetAsync(CancellationToken ct = default);
}
