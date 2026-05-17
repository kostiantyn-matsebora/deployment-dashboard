using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Request body for <c>POST /api/deployments</c> — the push-based ingest call
/// that your CI/CD pipeline makes after a deployment completes (or starts).
///
/// <para><b>Required fields:</b> <c>service</c>, <c>environment</c>,
/// <c>version</c>, <c>status</c>, <c>run_number</c>, <c>actor</c>,
/// <c>run_url</c>, <c>deployment_id</c>.</para>
///
/// <para><b>Optional fields:</b> <c>ref</c>, <c>sha</c>,
/// <c>parent_deployments</c>.</para>
///
/// <para><b>Validation:</b></para>
/// <list type="bullet">
///   <item>All required string fields reject null, empty, and whitespace-only values.</item>
///   <item>All string fields have length caps (see per-field docs).</item>
///   <item><c>status</c> must be one of the allowed lifecycle values.</item>
///   <item>Optional fields (<see cref="Ref"/>, <see cref="Sha"/>) treat
///   "omitted" and "explicit <c>null</c>" as equivalent on the wire; when
///   present, they must be non-empty and within their length cap.</item>
/// </list>
///
/// <para>Failures return <c>422 Unprocessable Entity</c> with an RFC 7807
/// problem document listing the offending fields.</para>
/// </summary>
public sealed record DeploymentEventRequest
{
    /// <summary>
    /// Stable identifier for this deployment event, chosen by the caller — a
    /// CI run id, build number, GUID, or any opaque string that is unique
    /// within the <see cref="Service"/>. Used to wire up explicit parent /
    /// child relationships via <see cref="ParentDeployments"/>.
    ///
    /// <para><b>Required.</b> 1–200 characters.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("deployment_id")]
    public string DeploymentId { get; init; } = string.Empty;

    /// <summary>
    /// Zero or more <c>deployment_id</c> values naming the parents of this
    /// deployment within the same <see cref="Service"/>. Use this when your
    /// pipeline knows the lineage explicitly (e.g. "this prod deploy promoted
    /// build X from staging"). When omitted or empty, the dashboard derives
    /// lineage on the read side from a configurable correlation attribute.
    ///
    /// <para><b>Optional.</b> Each element must be non-empty and at most 200 characters.</para>
    ///
    /// <para><b>Rules:</b></para>
    /// <list type="bullet">
    ///   <item>References to deployments in a different service are rejected with <c>400 Bad Request</c>.</item>
    ///   <item>References that would create a cycle through already-ingested deployments are rejected with <c>400 Bad Request</c>.</item>
    ///   <item>References to a deployment that has not yet been ingested are accepted and resolved later if and when the parent arrives.</item>
    /// </list>
    /// </summary>
    [ParentDeploymentsElements]
    [JsonPropertyName("parent_deployments")]
    public IReadOnlyList<string>? ParentDeployments { get; init; }

    /// <summary>
    /// Logical service identifier — the matrix row this event belongs to.
    /// Pick something stable per pipeline.
    ///
    /// <para><b>Required.</b> 1–200 characters.</para>
    ///
    /// <para><b>Examples:</b> <c>checkout-api</c>, <c>order-worker</c>.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("service")]
    public string Service { get; init; } = string.Empty;

    /// <summary>
    /// Target environment — the matrix column this event belongs to. New
    /// environment names appear in the dashboard automatically on first
    /// ingest — no pre-registration step.
    ///
    /// <para><b>Required.</b> 1–200 characters.</para>
    ///
    /// <para><b>Examples:</b> <c>dev</c>, <c>qa-1</c>, <c>prod</c>.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    /// <summary>
    /// Version label shown on the matrix tile — any opaque string the
    /// pipeline picks (semver, build number, image tag, ...).
    ///
    /// <para><b>Required.</b> 1–200 characters.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("version")]
    public string Version { get; init; } = string.Empty;

    /// <summary>
    /// Lifecycle status.
    ///
    /// <para><b>Required.</b> Allowed values: <c>in-progress</c>,
    /// <c>success</c>, <c>failure</c>. Any other value returns
    /// <c>422 Unprocessable Entity</c>.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [AllowedStatus]
    [JsonPropertyName("status")]
    public string Status { get; init; } = string.Empty;

    /// <summary>
    /// Absolute URL to the CI/CD run that produced this event — the dashboard
    /// renders it as the "View run" link on the tile.
    ///
    /// <para><b>Required.</b> Must be a syntactically valid URL, at most 2048
    /// characters.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(2048, MinimumLength = 1)]
    [Url]
    [JsonPropertyName("run_url")]
    public string RunUrl { get; init; } = string.Empty;

    /// <summary>
    /// Monotonic CI/CD run number — shown on the tile as <c>#123</c>.
    ///
    /// <para><b>Required.</b> Must be zero or positive.</para>
    /// </summary>
    [Range(0, long.MaxValue)]
    [JsonPropertyName("run_number")]
    public long RunNumber { get; init; }

    /// <summary>
    /// Who triggered the deployment — a username, bot id, or <c>system</c>
    /// for scheduled / automated triggers.
    ///
    /// <para><b>Required.</b> 1–200 characters.</para>
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("actor")]
    public string Actor { get; init; } = string.Empty;

    /// <summary>
    /// Source identifier — a branch name, PR number, tag, or any
    /// human-readable git ref. Independent of <see cref="Sha"/>.
    ///
    /// <para><b>Optional.</b> Omit, send <c>null</c>, or send a non-empty
    /// string up to 200 characters. No format check.</para>
    /// </summary>
    [StringLength(200)]
    [OptionalNotWhitespace]
    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    /// <summary>
    /// Commit SHA associated with this deployment. Independent of
    /// <see cref="Ref"/>.
    ///
    /// <para><b>Optional.</b> Omit, send <c>null</c>, or send a non-empty
    /// string up to 64 characters (room for SHA-256 hex). No hex / format
    /// check — any opaque identifier is accepted.</para>
    /// </summary>
    [StringLength(64)]
    [OptionalNotWhitespace]
    [JsonPropertyName("sha")]
    public string? Sha { get; init; }
}

/// <summary>
/// Validates that <c>status</c> is one of the allowed lifecycle values.
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
/// Rejects strings that are whitespace-only. Pairs with
/// <c>[Required(AllowEmptyStrings = false)]</c> on required string fields
/// so null, empty, and whitespace-only all surface as <c>422</c>. For
/// optional nullable fields, use <see cref="OptionalNotWhitespaceAttribute"/>
/// instead — it skips the check when the value is null.
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
/// (omitted or explicit-null on the wire) passes, but an empty or
/// whitespace-only string is rejected. Used on the optional
/// <see cref="DeploymentEventRequest.Ref"/> and
/// <see cref="DeploymentEventRequest.Sha"/> fields.
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
        if (value is null) return true; // omitted / explicit null are valid
        if (value is not string s) return true;
        return !string.IsNullOrWhiteSpace(s);
    }
}

/// <summary>
/// Per-element validation for <see cref="DeploymentEventRequest.ParentDeployments"/>:
/// every element must be non-empty (after trimming) and at most 200
/// characters. Per-element violations are surfaced as
/// <c>"parentDeployments[i]: ..."</c> entries under the
/// <c>parentDeployments</c> key in the validation problem response.
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public sealed class ParentDeploymentsElementsAttribute : ValidationAttribute
{
    /// <summary>Per-element length cap.</summary>
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
