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
    [JsonPropertyName("current")]
    public CurrentDeployment Current { get; init; } = default!;

    [JsonPropertyName("lastSuccessful")]
    public LastSuccessfulDeployment? LastSuccessful { get; init; }

    [JsonPropertyName("previousFailed")]
    public bool PreviousFailed { get; init; }
}

/// <summary>"current" sub-object — full event detail including status.</summary>
public sealed record CurrentDeployment
{
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;
    [JsonPropertyName("status")] public string Status { get; init; } = string.Empty;
    [JsonPropertyName("run_url")] public string RunUrl { get; init; } = string.Empty;
    [JsonPropertyName("run_number")] public long RunNumber { get; init; }
    [JsonPropertyName("actor")] public string Actor { get; init; } = string.Empty;
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
    [JsonPropertyName("deployment_id")] public string DeploymentId { get; init; } = string.Empty;
    [JsonPropertyName("version")] public string Version { get; init; } = string.Empty;
    [JsonPropertyName("run_url")] public string RunUrl { get; init; } = string.Empty;
    [JsonPropertyName("run_number")] public long RunNumber { get; init; }
    [JsonPropertyName("actor")] public string Actor { get; init; } = string.Empty;
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
