namespace Dashboard.Control.Repositories;

/// <summary>
/// String constants for the <c>reset_cycle.state</c> column and the <c>ResetState</c> OpenAPI enum.
/// </summary>
internal static class ResetState
{
    public const string Idle = "idle";
    public const string Draining = "draining";
    public const string Resetting = "resetting";
}
