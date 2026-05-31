namespace Dashboard.Control.Options;

/// <summary>
/// Configuration for the reset choreography state machine, bound from the <c>Reset</c> appsettings
/// section and overridable via environment variables (<c>Reset__AckTimeoutSeconds</c>, etc.) per §9.
/// </summary>
public sealed class ResetOptions
{
    public const string SectionName = "Reset";

    /// <summary>
    /// Max seconds to wait for component acks before forcing <c>draining → resetting</c> (D13).
    /// Default: 10 s.
    /// </summary>
    public int AckTimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// Component ids whose acks are awaited; snapshotted into <c>reset_cycle.expected_components</c>
    /// at cycle start. Default: <c>["dashboard-fetcher", "demo-driver"]</c> (D13).
    /// </summary>
    public string[] ExpectedComponents { get; set; } = ["dashboard-fetcher", "demo-driver"];

    /// <summary>
    /// Safety abort: if a cycle exceeds this duration, gates are released and state is forced
    /// back to <c>idle</c>. Prevents a dead driver wedging ingest (D12).
    /// Default: 60 s.
    /// </summary>
    public int GateMaxTtlSeconds { get; set; } = 60;
}
