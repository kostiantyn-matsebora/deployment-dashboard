using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Request body for <c>POST /api/deployments</c> (SAD §7 API Contract +
/// CI/CD Integration). Data Annotations drive payload validation — minimal
/// API <c>Validate</c> filter returns <c>422 Unprocessable Entity</c> when a
/// rule fails. <see cref="Status"/> is checked against the allowed set in
/// <see cref="Domain.DeploymentStatus.All"/> by a custom validator below so
/// invalid values produce 422 rather than 500.
///
/// <para><see cref="DeploymentId"/> and <see cref="ParentDeployments"/> are
/// the topology contract from SAD §5 / §7 "POST /api/deployments request
/// body". Cross-service / cycle / duplicate failures are handled outside
/// Data Annotations (they need DB lookups) — see <c>MapDeployments</c> in
/// the Write API.</para>
/// </summary>
public sealed record DeploymentEventRequest
{
    /// <summary>
    /// CI/CD-side identifier (run id, build number, guid). Required;
    /// missing or empty triggers <c>422 Unprocessable Entity</c>
    /// (SAD §7 POST validation table row 1).
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    /// <summary>
    /// Zero or more <c>deployment_id</c> values of parent deployments in the
    /// same <see cref="Service"/>. Omit or send <c>[]</c> to fall back to the
    /// correlation pass (SAD §5 "Topology Derivation"). Each entry must be a
    /// non-empty string; cross-service / cycle checks are deferred to the
    /// endpoint handler.
    /// </summary>
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string>? ParentDeployments { get; init; }

    [Required(AllowEmptyStrings = false)]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [AllowedStatus]
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [StringLength(2048, MinimumLength = 1)]
    [Url]
    [JsonPropertyName("run_url")]
    public string RunUrl { get; init; } = string.Empty;

    [Range(0, long.MaxValue)]
    [JsonPropertyName("run_number")]
    public long RunNumber { get; init; }

    [Required(AllowEmptyStrings = false)]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("actor")]
    public string Actor { get; init; } = string.Empty;

    /// <summary>
    /// Optional source identifier — branch name, PR number, tag, or any
    /// human-readable git ref (SAD §7 POST body row <c>ref</c> + FR-05).
    /// Independently optional from <see cref="Sha"/>. Absent, <c>null</c>,
    /// and string values are all accepted; absence and <c>null</c> are
    /// equivalent on the wire. <strong>No validation at this stage</strong> —
    /// no length cap, no format check; stricter validation is a deferred
    /// follow-up (SAD §10 Decision 10 + TODO #9).
    /// </summary>
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA associated with this deployment (SAD §7 POST body
    /// row <c>sha</c> + FR-05). Independently optional from <see cref="Ref"/>.
    /// Absent, <c>null</c>, and string values are all accepted; absence and
    /// <c>null</c> are equivalent on the wire. <strong>No validation at this
    /// stage</strong> — not required to be hex, not bounded to 7/40 chars;
    /// stricter validation is a deferred follow-up (SAD §10 Decision 10 +
    /// TODO #9).
    /// </summary>
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }
}

/// <summary>
/// Validates that <c>status</c> is one of the values defined in
/// <see cref="Domain.DeploymentStatus"/>. Custom attribute is used rather
/// than an enum so the wire form stays the literal kebab-case string
/// ("in-progress") that the SAD specifies.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class AllowedStatusAttribute : ValidationAttribute
{
    public AllowedStatusAttribute()
        : base("status must be one of: in-progress, success, failure")
    {
    }

    public override bool IsValid(object? value) =>
        value is string s && Domain.DeploymentStatus.All.Contains(s);
}
