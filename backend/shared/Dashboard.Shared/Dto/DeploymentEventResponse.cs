using System.Text.Json.Serialization;
using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Canonical deployment-event shape. Returned by <c>POST /api/deployments</c>
/// (as the <c>201 Created</c> body) and by the per-slot history endpoint.
/// All field names on the wire are snake_case.
/// </summary>
public sealed record DeploymentEventResponse
{
    /// <summary>
    /// Server-assigned auto-increment row id. Doubles as the SSE event id on
    /// the <c>/api/stream</c> endpoint and as the tie-breaker order key for
    /// history responses when two events share the same <c>deployed_at</c>.
    /// </summary>
    [JsonPropertyName("id")]
    public long Id { get; init; }

    /// <summary>
    /// Caller-supplied deployment identifier — echoed back verbatim from the
    /// original ingest request.
    /// </summary>
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Logical service identifier (the matrix row).</summary>
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    /// <summary>Target environment (the matrix column).</summary>
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    /// <summary>Version label shown on the matrix tile.</summary>
    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    /// <summary>
    /// Lifecycle status — one of <c>"in-progress"</c>, <c>"success"</c>,
    /// <c>"failure"</c>.
    /// </summary>
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>Absolute URL to the CI/CD run that produced this event.</summary>
    [JsonPropertyName("run_url")]
    public string RunUrl { get; init; } = string.Empty;

    /// <summary>Monotonic CI/CD run number.</summary>
    [JsonPropertyName("run_number")]
    public long RunNumber { get; init; }

    /// <summary>Who triggered the deployment — username, bot id, or "system".</summary>
    [JsonPropertyName("actor")]
    public string Actor { get; init; } = string.Empty;

    /// <summary>
    /// UTC timestamp at which the event was persisted. Always serialised with
    /// a trailing <c>Z</c> so client-side <c>Date</c> parsing is timezone-stable.
    /// </summary>
    [JsonPropertyName("deployed_at")]
    public DateTime DeployedAt { get; init; }

    /// <summary>
    /// Explicit parents of this deployment within the same service — echoed
    /// back verbatim from the ingest request. Empty when none were supplied.
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier (branch / tag / PR / opaque ref) echoed
    /// back from the ingest request. Always present in the response; the
    /// value is <c>null</c> when none was supplied.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA echoed back from the ingest request. Always
    /// present in the response; the value is <c>null</c> when none was
    /// supplied.
    /// </summary>
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }

    public static DeploymentEventResponse FromEntity(DeploymentEntity e) => new()
    {
        Id = e.Id,
        DeploymentId = e.DeploymentId,
        Service = e.Service,
        Environment = e.Environment,
        Version = e.Version,
        Status = e.Status,
        RunUrl = e.RunUrl,
        RunNumber = e.RunNumber,
        Actor = e.Actor,
        // PostgreSQL returns timestamps without an explicit Kind. Force UTC
        // so the wire form serialises with a trailing "Z" instead of an
        // ambiguous local-time string.
        DeployedAt = e.DeployedAt.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(e.DeployedAt, DateTimeKind.Utc)
            : e.DeployedAt.ToUniversalTime(),
        ParentDeployments = e.ParentDeployments is { Count: > 0 }
            ? e.ParentDeployments.ToArray()
            : Array.Empty<string>(),
        Ref = e.Ref,
        Sha = e.Sha,
    };
}
