using System.Text.Json.Serialization;
using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One slot in the deployment matrix — the state of a single
/// <c>(service, environment)</c> pair.
///
/// <para>Shape:</para>
/// <code>
/// {
///   "current":        { ... },
///   "lastSuccessful": null | { ... },
///   "previousFailed": false
/// }
/// </code>
///
/// <para>Note: <c>lastSuccessful</c> and <c>previousFailed</c> are
/// intentionally camelCase on the wire (the rest of the payload uses
/// snake_case).</para>
/// </summary>
public sealed record MatrixSlot
{
    /// <summary>
    /// Latest deployment event for this slot regardless of status — a failure
    /// replaces the previous entry, an in-progress replaces a success, etc.
    /// Always present once the slot has any history.
    /// </summary>
    [JsonPropertyName("current")]
    public CurrentDeployment Current { get; init; } = default!;

    /// <summary>
    /// Most recent <c>success</c> event for this slot, or <c>null</c> when
    /// <see cref="Current"/> is itself a success (no fallback needed) or
    /// when no success has ever been recorded for this slot. Lets clients
    /// show "currently failing, last good was vX" without an extra request.
    /// </summary>
    [JsonPropertyName("lastSuccessful")]
    public LastSuccessfulDeployment? LastSuccessful { get; init; }

    /// <summary>
    /// <c>true</c> when <see cref="Current"/> is <c>in-progress</c> AND the
    /// most recent terminal event before it was a failure — i.e. the slot is
    /// retrying after a failed run. Useful for distinguishing "first attempt
    /// in flight" from "retry of a known-broken deploy" in the UI.
    /// </summary>
    [JsonPropertyName("previousFailed")]
    public bool PreviousFailed { get; init; }
}

/// <summary>
/// The <c>current</c> sub-object inside a <see cref="MatrixSlot"/> — full
/// event detail for the latest deployment in the slot, including status.
/// </summary>
public sealed record CurrentDeployment
{
    /// <summary>Caller-supplied deployment identifier of the latest event in this slot.</summary>
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Version label shown on the tile.</summary>
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;

    /// <summary>Lifecycle status of the current event — drives the tile colour / badge.</summary>
    [JsonPropertyName("status")] public string Status { get; init; } = string.Empty;

    /// <summary>Absolute URL to the CI/CD run that produced the current event.</summary>
    [JsonPropertyName("run_url")] public string RunUrl { get; init; } = string.Empty;

    /// <summary>CI/CD run number of the current event.</summary>
    [JsonPropertyName("run_number")] public long RunNumber { get; init; }

    /// <summary>Who triggered the current event.</summary>
    [JsonPropertyName("actor")] public string Actor { get; init; } = string.Empty;

    /// <summary>UTC timestamp at which the current event was persisted.</summary>
    [JsonPropertyName("deployed_at")] public DateTime DeployedAt { get; init; }

    /// <summary>
    /// Explicit parents of the current event within the same service.
    /// Surfaced inline so clients can render lineage / "promoted from" links
    /// without a second round-trip. Empty when none were supplied.
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier (branch / tag / PR / opaque ref) verbatim
    /// from the ingest request. Always present in the response; the value is
    /// <c>null</c> when none was supplied.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA verbatim from the ingest request. Always present
    /// in the response; the value is <c>null</c> when none was supplied.
    /// </summary>
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }

    public static CurrentDeployment FromEntity(DeploymentEntity e) => new()
    {
        DeploymentId = e.DeploymentId,
        Version = e.Version,
        Status = e.Status,
        RunUrl = e.RunUrl,
        RunNumber = e.RunNumber,
        Actor = e.Actor,
        DeployedAt = AsUtc(e.DeployedAt),
        ParentDeployments = e.ParentDeployments is { Count: > 0 }
            ? e.ParentDeployments.ToArray()
            : Array.Empty<string>(),
        Ref = e.Ref,
        Sha = e.Sha,
    };

    private static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        _ => value.ToUniversalTime(),
    };
}

/// <summary>
/// The <c>lastSuccessful</c> sub-object inside a <see cref="MatrixSlot"/> —
/// same fields as <see cref="CurrentDeployment"/> minus <c>status</c>
/// (always implicitly <c>"success"</c> for this slot).
/// </summary>
public sealed record LastSuccessfulDeployment
{
    /// <summary>Caller-supplied deployment identifier of the last successful event in this slot.</summary>
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Version label of the last successful event.</summary>
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;

    /// <summary>Absolute URL to the run that produced the last success.</summary>
    [JsonPropertyName("run_url")] public string RunUrl { get; init; } = string.Empty;

    /// <summary>Run number of the last success.</summary>
    [JsonPropertyName("run_number")] public long RunNumber { get; init; }

    /// <summary>Who triggered the last success.</summary>
    [JsonPropertyName("actor")] public string Actor { get; init; } = string.Empty;

    /// <summary>UTC timestamp at which the last success was persisted.</summary>
    [JsonPropertyName("deployed_at")] public DateTime DeployedAt { get; init; }

    /// <summary>
    /// Explicit parents of the last successful event within the same service.
    /// Empty when none were supplied.
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier verbatim from the original ingest request.
    /// Always present in the response; the value is <c>null</c> when none
    /// was supplied.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA verbatim from the original ingest request. Always
    /// present in the response; the value is <c>null</c> when none was
    /// supplied.
    /// </summary>
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }

    public static LastSuccessfulDeployment FromEntity(DeploymentEntity e) => new()
    {
        DeploymentId = e.DeploymentId,
        Version = e.Version,
        RunUrl = e.RunUrl,
        RunNumber = e.RunNumber,
        Actor = e.Actor,
        DeployedAt = e.DeployedAt.Kind switch
        {
            DateTimeKind.Utc => e.DeployedAt,
            DateTimeKind.Unspecified => DateTime.SpecifyKind(e.DeployedAt, DateTimeKind.Utc),
            _ => e.DeployedAt.ToUniversalTime(),
        },
        ParentDeployments = e.ParentDeployments is { Count: > 0 }
            ? e.ParentDeployments.ToArray()
            : Array.Empty<string>(),
        Ref = e.Ref,
        Sha = e.Sha,
    };
}
