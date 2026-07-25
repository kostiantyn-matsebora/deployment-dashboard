namespace Dashboard.Control.Repositories;

/// <summary>
/// String constants for the <c>reset_cycle.operation</c> column — discriminates which
/// choreography (reset vs recover) owns the shared single-flight row (D12), so the
/// orchestrator/reconciler know which <c>*-completed</c> event type to emit.
/// </summary>
internal static class ControlOperation
{
    public const string Reset = "reset";
    public const string Recover = "recover";
}
