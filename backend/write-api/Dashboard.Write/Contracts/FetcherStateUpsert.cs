using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace Dashboard.Write.Contracts;

/// <summary>
/// Request body for <c>PUT /api/fetcher/state/{adapter}</c>.
/// The cursor is stored verbatim; the backend never parses or validates its content.
/// </summary>
[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record FetcherStateUpsert
{
    /// <summary>Opaque cursor blob. Max 8 KiB.</summary>
    [Required]
    [JsonPropertyName("cursor")]
    public required string Cursor { get; init; }
}
