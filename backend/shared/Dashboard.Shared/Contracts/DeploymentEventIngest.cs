using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Contracts;

// D5: unknown write fields → 422. The exception is caught by the global exception handler.

/// <summary>
/// Request body for <c>POST /api/deployments</c>.
/// Every accepted body appends exactly one row; the store does not deduplicate.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DeploymentEventIngest
{
    [Required]
    [MinLength(1)]
    [MaxLength(200)]
    [JsonPropertyName("deployment_id")]
    public required string DeploymentId { get; init; }

    [Required]
    [MinLength(1)]
    [MaxLength(128)]
    [JsonPropertyName("service")]
    public required string Service { get; init; }

    /// <summary>CI/CD-agnostic namespace grouping this service. GitHub adapter sets this to the repo short name. Max 128 chars. Omit when not applicable.</summary>
    [MaxLength(128)]
    [JsonPropertyName("namespace")]
    public string? Namespace { get; init; }

    [Required]
    [MinLength(1)]
    [MaxLength(64)]
    [JsonPropertyName("environment")]
    public required string Environment { get; init; }

    [MaxLength(50)]
    [JsonPropertyName("version")]
    public string? Version { get; init; }

    /// <summary>Must be one of <see cref="DeploymentStatus"/> constants. Validated in Phase 3.</summary>
    [Required]
    [JsonPropertyName("status")]
    public required string Status { get; init; }

    [Required]
    [JsonPropertyName("happened_at")]
    public required DateTimeOffset HappenedAt { get; init; }

    [MaxLength(2048)]
    [JsonPropertyName("run_url")]
    public string? RunUrl { get; init; }

    [MaxLength(128)]
    [JsonPropertyName("run_number")]
    public string? RunNumber { get; init; }

    [MaxLength(128)]
    [JsonPropertyName("actor")]
    public string? Actor { get; init; }

    [MaxLength(256)]
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    [MaxLength(128)]
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }

    /// <summary>
    /// Upstream <c>deployment_id</c> correlation keys. Max 32 items.
    /// Validated for item count in Phase 3 (DataAnnotations has no MaxCount attribute).
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public string[]? ParentDeployments { get; init; }
}
