using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Dashboard.Shared.Domain;

namespace Dashboard.Shared.Dto;

/// <summary>
/// Request body for <c>PUT /api/fetcher/state/{source-id}</c> — opaque cursor
/// upsert (CR-0009 + ADR-0004 Decision 2). The backend never parses
/// <see cref="Cursor"/>; it stores the supplied string verbatim within the
/// length cap.
/// </summary>
public sealed record FetcherStateRequest
{
    /// <summary>
    /// Opaque cursor blob, owned and shaped by the adapter (deployment id,
    /// JSON tuple, base64-encoded watermark, etc.). 1–4096 characters,
    /// non-whitespace.
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(4096, MinimumLength = 1)]
    [JsonPropertyName("cursor")]
    public string Cursor { get; init; } = string.Empty;
}

/// <summary>
/// Response shape for <c>GET</c>/<c>PUT /api/fetcher/state/{source-id}</c>
/// (CR-0009). Echoes the persisted row — the universal pusher-attribution
/// token, the per-adapter logical scope, the opaque cursor, and the
/// server-stamped <see cref="UpdatedAt"/> so callers can verify the
/// round-trip without an extra GET.
/// </summary>
public sealed record FetcherStateResponse
{
    /// <summary>Pusher-attribution token (the value of <c>X-Progress-Reporter</c> on the read/write).</summary>
    [JsonPropertyName("progress_reporter")]
    public string ProgressReporter { get; init; } = string.Empty;

    /// <summary>Adapter-local logical scope (e.g. <c>owner/repo</c>).</summary>
    [JsonPropertyName("source_id")]
    public string SourceId { get; init; } = string.Empty;

    /// <summary>Opaque cursor blob — backend stores verbatim, never parses.</summary>
    [JsonPropertyName("cursor")]
    public string Cursor { get; init; } = string.Empty;

    /// <summary>
    /// UTC timestamp of the most recent upsert. Always serialised with a
    /// trailing <c>Z</c> for timezone-stable client parsing.
    /// </summary>
    [JsonPropertyName("updated_at")]
    public DateTime UpdatedAt { get; init; }

    public static FetcherStateResponse FromEntity(FetcherStateEntity e) => new()
    {
        ProgressReporter = e.ProgressReporter,
        SourceId = e.SourceId,
        Cursor = e.Cursor,
        UpdatedAt = e.UpdatedAt.Kind switch
        {
            DateTimeKind.Utc => e.UpdatedAt,
            DateTimeKind.Unspecified => DateTime.SpecifyKind(e.UpdatedAt, DateTimeKind.Utc),
            _ => e.UpdatedAt.ToUniversalTime(),
        },
    };
}
