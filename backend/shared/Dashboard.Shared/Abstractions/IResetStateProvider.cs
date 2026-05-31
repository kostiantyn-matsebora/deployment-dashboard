namespace Dashboard.Shared.Abstractions;

/// <summary>
/// Provides the per-instance cached reset state used by the ingest gate filter (Fix C).
/// Implemented by <c>ResetStateListener</c> in Dashboard.Control; updated via <c>LISTEN reset_state</c>.
/// Lives in Dashboard.Shared so Dashboard.Write can depend on it without a circular reference.
/// </summary>
public interface IResetStateProvider
{
    /// <summary>
    /// <c>true</c> when this instance believes the state machine is in the <c>resetting</c> phase.
    /// Seeded from DB at startup; kept current via <c>NOTIFY reset_state</c>.
    /// </summary>
    bool IsResetting { get; }
}
