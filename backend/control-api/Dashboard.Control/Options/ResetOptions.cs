namespace Dashboard.Control.Options;

/// <summary>
/// Configuration for the reset choreography state machine, bound from the <c>Reset</c> appsettings
/// section and overridable via flat SCREAMING_SNAKE environment variables
/// (<c>RESET_ACK_TIMEOUT_SECONDS</c>, <c>RESET_GATE_MAX_TTL_SECONDS</c>,
/// <c>RESET_EXPECTED_COMPONENTS</c> as a CSV, <c>RESET_RECOVER_MAX_DAYS_BACK</c>) per §9.
/// </summary>
public sealed class ResetOptions
{
    public const string SectionName = "Reset";

    /// <summary>
    /// Max seconds to wait for component acks before forcing <c>draining → resetting</c> (D13).
    /// Default: 10 s. Override via <c>RESET_ACK_TIMEOUT_SECONDS</c> env var.
    /// </summary>
    public int AckTimeoutSeconds { get; set; } = 10;

    /// <summary>
    /// Component ids whose acks are awaited; snapshotted into <c>reset_cycle.expected_components</c>
    /// at cycle start. The effective default (<c>["dashboard-fetcher", "demo-driver"]</c>, D13) is
    /// supplied by <c>appsettings.json</c>, NOT a C# initializer here.
    ///
    /// Override via <c>RESET_EXPECTED_COMPONENTS</c> env var (CSV string — comma-separated component
    /// ids, trimmed, empty entries dropped — replaces the array wholesale when non-empty).
    ///
    /// This MUST stay empty. The .NET configuration binder <b>appends</b> config-bound array
    /// elements onto the property's existing value rather than replacing it. A non-empty
    /// initializer would therefore survive every config override, leaving phantom entries in the
    /// bound array and making the ack gate wait on components that never ack. Keeping it empty
    /// lets <c>appsettings.json</c> fully define the default set.
    /// </summary>
    public string[] ExpectedComponents { get; set; } = [];

    /// <summary>
    /// Hard wall-clock ceiling on the entire orchestrator cycle (draining → resetting → idle),
    /// including the data-clearing phase. When the ceiling is reached the cycle is force-aborted:
    /// state is written to <c>idle</c>, a <c>reset-completed</c> control-stream event is emitted
    /// so connected components can recover, and the Postgres advisory lock is released.
    /// Prevents a hung DB call (e.g. a blocked TRUNCATE) wedging ingest indefinitely (D12).
    /// Default: 60 s. Override via <c>RESET_GATE_MAX_TTL_SECONDS</c> env var.
    /// </summary>
    public int GateMaxTtlSeconds { get; set; } = 60;

    /// <summary>
    /// Upper bound, in whole days, on how far <c>POST /api/control/recover</c> may rewind fetcher
    /// cursors — applies to both the relative <c>days_back</c> field (must be <c>&lt;=</c> this
    /// value) and the absolute <c>since</c> field (must not be older than <c>now - this many
    /// days</c>). Guards against an unbounded re-poll cost and against <c>days_back</c> values
    /// large enough to overflow <see cref="DateTimeOffset.AddDays(double)"/> (e.g.
    /// <see cref="int.MaxValue"/>), which would otherwise throw
    /// <see cref="ArgumentOutOfRangeException"/> uncaught (→ 500) — the endpoint validates this
    /// bound before calling <c>AddDays</c>. Default: 90 days. Override via
    /// <c>RESET_RECOVER_MAX_DAYS_BACK</c> env var.
    /// </summary>
    public int RecoverMaxDaysBack { get; set; } = 90;
}
