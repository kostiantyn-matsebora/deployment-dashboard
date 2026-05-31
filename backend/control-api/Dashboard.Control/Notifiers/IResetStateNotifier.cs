namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues <c>NOTIFY reset_state</c> with the new state string as payload.
/// Every API instance's <c>ResetStateListener</c> picks this up and updates its
/// in-process cached flag so the ingest gate doesn't hit the DB on every request (Fix C).
/// </summary>
internal interface IResetStateNotifier
{
    Task NotifyStateAsync(string state, CancellationToken ct = default);
}
