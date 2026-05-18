using System.ComponentModel.DataAnnotations.Schema;

namespace Dashboard.Shared.Domain;

/// <summary>
/// EF Core entity for the <c>fetcher_state</c> table (CR-0009 + ADR-0004 —
/// opaque, per-<c>progress_reporter</c>, backend-held cursor).
///
/// <para>The <see cref="Cursor"/> blob is an adapter-owned opaque string
/// (length-capped at 4096 chars; the backend never parses it). The composite
/// primary key <c>(progress_reporter, source_id)</c> mirrors the universal
/// <c>X-Progress-Reporter</c> header concept used by every push caller
/// (CR-0009 § 3c — "pull-mode is a strict subset of push-mode"); a single
/// fetcher that scrapes N repositories therefore owns N rows under the same
/// <see cref="ProgressReporter"/>.</para>
///
/// <para><see cref="UpdatedAt"/> is server-stamped on every upsert by the
/// Write endpoint handler so callers can verify the round-trip without an
/// additional GET.</para>
/// </summary>
[Table("fetcher_state")]
public sealed class FetcherStateEntity
{
    /// <summary>Pusher-attribution token — first half of the composite key.</summary>
    [Column("progress_reporter")]
    public string ProgressReporter { get; set; } = string.Empty;

    /// <summary>
    /// Adapter-local logical scope (e.g. <c>owner/repo</c> for the GHA
    /// adapter, a project name for ADO, etc.) — second half of the composite
    /// key. The backend treats it as opaque path-param data.
    /// </summary>
    [Column("source_id")]
    public string SourceId { get; set; } = string.Empty;

    /// <summary>
    /// Opaque adapter-owned cursor blob. Required, length-capped at 4096
    /// characters (ADR-0004 Decision 2). The backend never inspects the
    /// content.
    /// </summary>
    [Column("cursor")]
    public string Cursor { get; set; } = string.Empty;

    /// <summary>UTC timestamp of the most recent upsert.</summary>
    [Column("updated_at")]
    public DateTime UpdatedAt { get; set; }
}
