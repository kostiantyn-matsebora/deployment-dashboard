using System.Text.Json.Serialization;
using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Dto;

/// <summary>
/// One slot in the matrix response. Wire shape matches the JSON example in
/// SAD §7 "Matrix response shape per service":
/// <code>
/// {
///   "current":        { ... },
///   "lastSuccessful": null | { ... },
///   "previousFailed": false
/// }
/// </code>
/// Note that <c>lastSuccessful</c> and <c>previousFailed</c> are
/// intentionally camelCase in the wire form — the mockup
/// (<c>docs/ui/deployment-dashboard.html</c>) reads them as
/// <c>lastSuccessful</c> / <c>previousFailed</c> directly.
/// </summary>
public sealed record MatrixSlot
{
    /// <summary>
    /// Latest deployment event for this <c>(service, environment)</c> slot
    /// regardless of status — failures replace the previous entry per SAD §7
    /// Decision 3.
    /// </summary>
    [JsonPropertyName("current")]
    public CurrentDeployment Current { get; init; } = default!;

    /// <summary>
    /// Most recent <c>success</c> event for the slot, or <c>null</c> when
    /// <see cref="Current"/> is itself a success (no fallback needed) or when
    /// no success has ever been recorded for this slot.
    /// </summary>
    [JsonPropertyName("lastSuccessful")]
    public LastSuccessfulDeployment? LastSuccessful { get; init; }

    /// <summary>
    /// <c>true</c> iff <see cref="Current"/> is <c>in-progress</c> AND the
    /// most recent terminal event before it was a failure — so the SPA paints
    /// the "in-progress over a failure" box state from the mockup.
    /// </summary>
    [JsonPropertyName("previousFailed")]
    public bool PreviousFailed { get; init; }
}

/// <summary>"current" sub-object — full event detail including status.</summary>
public sealed record CurrentDeployment
{
    /// <summary>CI/CD-side identifier of the latest event in this slot.</summary>
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Version string shown on the tile.</summary>
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;

    /// <summary>Lifecycle status of the current event — drives the box state.</summary>
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
    /// Surfaced on the wire per SAD §7 "Matrix response shape — per service"
    /// ("<c>current.deployment_id</c> and <c>current.parent_deployments</c>
    /// are surfaced on the wire so the SPA can render explicit parent links").
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier verbatim from the stored row (SAD §7 +
    /// FR-05). Always emitted; <c>null</c> when the column is null. Matches
    /// the SAD JSON example at §7 "Matrix response shape" exactly.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA verbatim from the stored row (SAD §7 + FR-05).
    /// Same emission rule as <see cref="Ref"/>.
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
/// "lastSuccessful" sub-object — same shape as current minus the status
/// field, which is always implicitly "success" for this slot. Per SAD §7
/// "Matrix response shape" field rules, this object also carries
/// <c>deployment_id</c> and <c>parent_deployments</c> for symmetry with
/// <see cref="CurrentDeployment"/>.
/// </summary>
public sealed record LastSuccessfulDeployment
{
    /// <summary>CI/CD-side identifier of the last successful event in this slot.</summary>
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Version string of the last successful event.</summary>
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;

    /// <summary>Absolute URL to the run that produced the last success.</summary>
    [JsonPropertyName("run_url")] public string RunUrl { get; init; } = string.Empty;

    /// <summary>Run number of the last success.</summary>
    [JsonPropertyName("run_number")] public long RunNumber { get; init; }

    /// <summary>Who triggered the last success.</summary>
    [JsonPropertyName("actor")] public string Actor { get; init; } = string.Empty;

    /// <summary>UTC timestamp at which the last success was persisted.</summary>
    [JsonPropertyName("deployed_at")] public DateTime DeployedAt { get; init; }

    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier verbatim from the stored row (SAD §7 +
    /// FR-05). Always emitted; <c>null</c> when the column is null. Matches
    /// the SAD JSON example at §7 "Matrix response shape" exactly.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA verbatim from the stored row (SAD §7 + FR-05).
    /// Same emission rule as <see cref="Ref"/>.
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
