using System.Text.Json.Serialization;

namespace Dashboard.Control.Models;

// D5-style: unknown fields → 422 (JsonUnmappedMemberHandling.Disallow → JsonException → the
// global exception handler's JsonException → 422 mapping, same as ComponentEventIngest).

/// <summary>
/// Request body for <c>POST /api/control/recover</c> (OpenAPI <c>RecoverRequest</c>).
/// Specifies the rewind point as <b>either</b> an absolute <see cref="Since"/> timestamp
/// <b>or</b> a relative <see cref="DaysBack"/> count — exactly one must be supplied. Neither
/// property carries <c>required</c>/<c>[Required]</c> because the <c>oneOf</c> shape can't be
/// expressed that way; the endpoint handler validates the XOR and resolves <c>days_back</c> to
/// an absolute <c>since</c> (422 Problem when the rule is violated).
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record RecoverRequest
{
    /// <summary>
    /// Absolute UTC instant to rewind fetcher cursors to. Mutually exclusive with
    /// <see cref="DaysBack"/>.
    /// </summary>
    [JsonPropertyName("since")]
    public DateTimeOffset? Since { get; init; }

    /// <summary>
    /// Whole days to rewind from the current server time; resolved server-side to
    /// <c>since = now − days_back days</c>. Must be ≥ 1. Mutually exclusive with
    /// <see cref="Since"/>.
    /// </summary>
    [JsonPropertyName("days_back")]
    public int? DaysBack { get; init; }
}
