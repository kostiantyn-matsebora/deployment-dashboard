using System.Text.Json.Serialization;
using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Response body for <c>POST /api/deployments</c> (201 Created) and for
/// the matrix/history endpoints. Wire format is snake_case via
/// <see cref="JsonPropertyName"/>; the receiving DTOs in the frontend
/// match exactly (see <c>docs/ui/deployment-dashboard.html</c>).
/// </summary>
public sealed record DeploymentEventResponse
{
    /// <summary>
    /// Server-assigned auto-increment row id. Used as the SSE event id and as
    /// the secondary order key for history requests when two events share a
    /// <c>deployed_at</c> timestamp.
    /// </summary>
    [JsonPropertyName("id")]
    public long Id { get; init; }

    /// <summary>
    /// CI/CD-side deployment identifier — verbatim from the request payload.
    /// Used by the SPA to render explicit parent links in the history drawer.
    /// </summary>
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    /// <summary>Logical service identifier — the matrix's row key.</summary>
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    /// <summary>Target environment — the matrix's column key.</summary>
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    /// <summary>Version string shown on the matrix tile.</summary>
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
    /// UTC timestamp at which the row was persisted. Always serialised with a
    /// trailing <c>Z</c> so the SPA's <c>Date</c> parsing is timezone-stable
    /// regardless of the underlying DB provider.
    /// </summary>
    [JsonPropertyName("deployed_at")]
    public DateTime DeployedAt { get; init; }

    /// <summary>
    /// Verbatim copy of the entity's <c>parent_deployments</c>. Surfaced on
    /// the wire per SAD §7 "Matrix response shape — per service" so the SPA
    /// can render the history drawer's explicit lineage without a second
    /// round-trip. Empty when the deployment had no explicit parents.
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string> ParentDeployments { get; init; } = Array.Empty<string>();

    /// <summary>
    /// Optional source identifier verbatim from the stored row (SAD §7 +
    /// FR-05). Per SAD field rules ("absent and <c>null</c> are equivalent"),
    /// this implementation always emits the property and serialises a
    /// <c>null</c> when the column is null — a stable shape that matches the
    /// SAD JSON example at §7 "Matrix response shape" exactly.
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA verbatim from the stored row (SAD §7 + FR-05).
    /// Same emission rule as <see cref="Ref"/>: always present, <c>null</c>
    /// when absent.
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
        // ambiguous local-time string, matching the mockup contract.
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
