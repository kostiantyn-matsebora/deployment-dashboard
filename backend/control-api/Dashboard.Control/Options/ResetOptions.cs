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
    /// at cycle start. The effective default (<c>["dashboard-fetcher", "demo-driver"]</c>, D13) is
    /// supplied by <c>appsettings.json</c>, NOT a C# initializer here.
    ///
    /// This MUST stay empty. The .NET configuration binder <b>appends</b> config-bound array
    /// elements onto the property's existing value rather than replacing it. A non-empty
    /// initializer would therefore survive every config/env override (e.g.
    /// <c>Reset__ExpectedComponents__0=…</c>), leaving phantom entries in the bound array and
    /// making the ack gate wait on components that never ack. Keeping it empty lets
    /// <c>appsettings.json</c> / environment fully define the set.
    /// </summary>
    public string[] ExpectedComponents { get; set; } = [];

    /// <summary>
    /// Hard wall-clock ceiling on the entire orchestrator cycle (draining → resetting → idle),
    /// including the data-clearing phase. When the ceiling is reached the cycle is force-aborted:
    /// state is written to <c>idle</c>, a <c>reset-completed</c> control-stream event is emitted
    /// so connected components can recover, and the Postgres advisory lock is released.
    /// Prevents a hung DB call (e.g. a blocked TRUNCATE) wedging ingest indefinitely (D12).
    /// Default: 60 s.
    /// </summary>
    public int GateMaxTtlSeconds { get; set; } = 60;
}
