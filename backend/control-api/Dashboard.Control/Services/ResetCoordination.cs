namespace Dashboard.Control.Services;

/// <summary>
/// Shared constants for reset-cycle coordination across the active driver
/// (<see cref="ResetOrchestrator"/>) and the crash-recovery <see cref="ResetReconciler"/>.
/// </summary>
internal static class ResetCoordination
{
    /// <summary>
    /// Fixed Postgres advisory-lock key that elects the single reset driver across
    /// stateless API instances (D12). Both the orchestrator and the reconciler contend
    /// on this one key, so they can never drive a cycle concurrently.
    /// </summary>
    public const long AdvisoryLockKey = 7_654_321L;
}
