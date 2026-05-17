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
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    [JsonPropertyName("run_url")]
    public string RunUrl { get; init; } = string.Empty;

    [JsonPropertyName("run_number")]
    public long RunNumber { get; init; }

    [JsonPropertyName("actor")]
    public string Actor { get; init; } = string.Empty;

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
