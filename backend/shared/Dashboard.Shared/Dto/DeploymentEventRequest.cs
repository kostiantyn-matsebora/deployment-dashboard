using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Request body for <c>POST /api/deployments</c> (SAD §7 API Contract +
/// CI/CD Integration; length caps + non-whitespace rules per CR-0008).
/// Data Annotations drive payload validation — the endpoint runs
/// <see cref="Validation.DataAnnotationsValidator.Validate"/> and returns
/// <c>422 Unprocessable Entity</c> with an RFC 7807 <c>ValidationProblemDetails</c>
/// body when a rule fails.
///
/// <para><see cref="Status"/> is checked against the allowed set in
/// <see cref="Domain.DeploymentStatus.All"/> by <see cref="AllowedStatusAttribute"/>
/// below so invalid values produce 422 rather than 500.</para>
///
/// <para>Required string fields use <c>[Required(AllowEmptyStrings = false)]</c>
/// (rejects null and empty) plus <see cref="NotWhitespaceAttribute"/> (rejects
/// whitespace-only). Optional string fields (<see cref="Ref"/>,
/// <see cref="Sha"/>) are nullable: absent and <c>null</c> are equivalent;
/// when present, the value must be non-whitespace-empty and within the
/// per-field <c>maxLength</c> cap (CR-0008 § "Universal rules").</para>
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
    /// missing, empty, or whitespace-only triggers <c>422 Unprocessable Entity</c>
    /// (CR-0008 validation table row 1).
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    /// <summary>
    /// Zero or more <c>deployment_id</c> values of parent deployments in the
    /// same <see cref="Service"/>. Omit or send <c>[]</c> to fall back to the
    /// correlation pass (SAD §5 "Topology Derivation"). Per CR-0008 each
    /// element must be non-whitespace-empty AND ≤ 200 chars; per-element
    /// violations land in the <c>parentDeployments</c> error key as messages
    /// of the form <c>"parentDeployments[i]: ..."</c>. Cross-service / cycle
    /// checks are deferred to the endpoint handler.
    /// </summary>
    [ParentDeploymentsElements]
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string>? ParentDeployments { get; init; }

    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [AllowedStatus]
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(2048, MinimumLength = 1)]
    [Url]
    [JsonPropertyName("run_url")]
    public string RunUrl { get; init; } = string.Empty;

    [Range(0, long.MaxValue)]
    [JsonPropertyName("run_number")]
    public long RunNumber { get; init; }

    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("actor")]
    public string Actor { get; init; } = string.Empty;

    /// <summary>
    /// Optional source identifier — branch name, PR number, tag, or any
    /// human-readable git ref (SAD §7 POST body row <c>ref</c> + FR-05).
    /// Independently optional from <see cref="Sha"/>. Absent and <c>null</c>
    /// are equivalent on the wire. When present, must be non-whitespace-empty
    /// AND ≤ 200 chars (CR-0008 — closes CR-0004 § Decision 10). No
    /// format / regex check.
    /// </summary>
    [StringLength(200)]
    [OptionalNotWhitespace]
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Optional commit SHA associated with this deployment (SAD §7 POST body
    /// row <c>sha</c> + FR-05). Independently optional from <see cref="Ref"/>.
    /// Absent and <c>null</c> are equivalent on the wire. When present, must
    /// be non-whitespace-empty AND ≤ 64 chars (CR-0008 — covers SHA-256 hex;
    /// SHA-1 hex and short SHAs fit comfortably). No hex / format check.
    /// </summary>
    [StringLength(64)]
    [OptionalNotWhitespace]
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

/// <summary>
/// Rejects strings that are whitespace-only (e.g. <c>"   "</c>). Pairs with
/// <c>[Required(AllowEmptyStrings = false)]</c> on required string fields so
/// all three forms (null, empty, whitespace-only) reliably produce 422
/// (CR-0008 § "Universal rules").
///
/// <para>For nullable fields (<see cref="DeploymentEventRequest.Ref"/> and
/// <see cref="DeploymentEventRequest.Sha"/>) use
/// <see cref="OptionalNotWhitespaceAttribute"/> instead — it skips the check
/// when the value is null (absent / explicit-null are equivalent per
/// CR-0008).</para>
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class NotWhitespaceAttribute : ValidationAttribute
{
    public NotWhitespaceAttribute()
        : base("The {0} field must not be whitespace-only.")
    {
    }

    public override bool IsValid(object? value)
    {
        // null and empty are caught by [Required(AllowEmptyStrings = false)]
        // — only flag whitespace-only here so error messages don't double up.
        if (value is null) return true;
        if (value is not string s) return true;
        if (s.Length == 0) return true;
        return !string.IsNullOrWhiteSpace(s);
    }
}

/// <summary>
/// Optional-string variant of <see cref="NotWhitespaceAttribute"/>: null
/// (absent or explicit-null on the wire) passes, but an empty string or
/// whitespace-only string is rejected. Used on <see cref="DeploymentEventRequest.Ref"/>
/// and <see cref="DeploymentEventRequest.Sha"/> per CR-0008 § "Universal rules":
/// "Optional string fields: null and absent are equivalent; an empty string
/// is rejected with 422".
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class OptionalNotWhitespaceAttribute : ValidationAttribute
{
    public OptionalNotWhitespaceAttribute()
        : base("The {0} field, when present, must not be empty or whitespace-only.")
    {
    }

    public override bool IsValid(object? value)
    {
        if (value is null) return true; // absent / explicit null are valid
        if (value is not string s) return true;
        return !string.IsNullOrWhiteSpace(s);
    }
}

/// <summary>
/// Per-element validation for <see cref="DeploymentEventRequest.ParentDeployments"/>:
/// every element must be non-whitespace-empty AND ≤ 200 chars (CR-0008 row
/// <c>parent_deployments[i]</c>). Per-element messages are surfaced as
/// "parentDeployments[i]: ..." entries under the <c>parentDeployments</c>
/// error key in <c>ValidationProblemDetails</c>.
///
/// <para>Returns a <see cref="ValidationResult"/> whose
/// <see cref="ValidationResult.ErrorMessage"/> contains all per-element
/// violations newline-joined; <see cref="Validation.DataAnnotationsValidator"/>
/// splits that back into per-message entries downstream.</para>
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class ParentDeploymentsElementsAttribute : ValidationAttribute
{
    /// <summary>Per-element length cap (CR-0008).</summary>
    public const int ElementMaxLength = 200;

    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (value is null) return ValidationResult.Success;
        if (value is not System.Collections.IEnumerable enumerable) return ValidationResult.Success;

        var memberName = context.MemberName ?? string.Empty;
        var messages = new List<string>();
        var index = 0;
        foreach (var element in enumerable)
        {
            switch (element)
            {
                case null:
                    messages.Add($"parentDeployments[{index}]: element must not be null.");
                    break;
                case string s when string.IsNullOrWhiteSpace(s):
                    messages.Add($"parentDeployments[{index}]: element must not be empty or whitespace-only.");
                    break;
                case string s when s.Length > ElementMaxLength:
                    messages.Add($"parentDeployments[{index}]: element must not exceed {ElementMaxLength} characters.");
                    break;
            }
            index++;
        }

        if (messages.Count == 0) return ValidationResult.Success;
        return new ValidationResult(
            string.Join('\n', messages),
            new[] { memberName });
    }
}
