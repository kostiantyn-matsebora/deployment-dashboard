using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Dashboard.Shared.Dto;

namespace Dashboard.Shared.Fetcher;

/// <summary>
/// Request body for <c>POST /api/fetcher/usage</c> (CR-0011 § 3b — Write
/// surface). The fetcher pushes one of these per poll tick per
/// <c>(adapter_id, source_id)</c> pair so the dashboard can render
/// per-repo rate-limit usage on the stats strip.
///
/// <para>Wire field summary (snake_case per the API contract):</para>
/// <list type="bullet">
///   <item><c>adapter_id</c> — adapter identity (e.g. <c>github-actions</c>).</item>
///   <item><c>source_id</c> — per-fetch logical scope (e.g. <c>owner/repo</c>).</item>
///   <item><c>upstream_limit</c> — provider's <c>X-RateLimit-Limit</c>.</item>
///   <item><c>upstream_remaining</c> — provider's <c>X-RateLimit-Remaining</c>.</item>
///   <item><c>upstream_reset_at</c> — provider's window reset time, UTC.</item>
///   <item><c>self_imposed_cap</c> — resolved absolute cap for this
///   window (per CR-0011 precedence; <see cref="Dashboard.Fetcher"/>'s
///   resolver decides between <c>FETCHER_RATE_LIMIT_ABSOLUTE</c> and
///   <c>FETCHER_RATE_LIMIT_PERCENTAGE</c>).</item>
///   <item><c>upstream_used</c> — derived as
///   <c>upstream_limit − upstream_remaining</c> by the fetcher (CR-0011
///   D3 — wire field is the upstream-observed value, NOT a fetcher-side
///   counter).</item>
///   <item><c>observed_at</c> — fetcher wall-clock at the moment the
///   headers were read; sent so the backend doesn't need clock-skew
///   correction.</item>
/// </list>
///
/// <para>Validation follows the canonical CR-0008 length-only + 422
/// ValidationProblemDetails contract. Strings: required + non-whitespace
/// + length-capped. Integers: bounded ranges that match the wire-field
/// semantics. <see cref="UpstreamResetAt"/> + <see cref="ObservedAt"/>
/// are typed as <see cref="Nullable{DateTime}"/> so an omitted JSON key
/// surfaces as <c>null</c> (System.Text.Json never reports a presence
/// failure on a non-nullable <see cref="DateTime"/> — it silently
/// substitutes <c>default(DateTime)</c> = <c>0001-01-01T00:00:00</c>,
/// which would slip past <c>[Required]</c>). The Write handler performs a
/// hand-rolled presence check before <c>DataAnnotationsValidator</c> runs
/// (CR-0008 § 3a 422 contract); the resulting error map is keyed by the
/// camelCase JSON name (<c>upstreamResetAt</c> / <c>observedAt</c>).</para>
/// </summary>
public sealed record FetcherUsageSnapshotRequest
{
    /// <summary>
    /// Adapter identity — same value the adapter exposes via
    /// <c>ICiCdAdapter.AdapterId</c> (e.g. <c>github-actions</c>).
    /// 1–64 characters, non-whitespace.
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(64, MinimumLength = 1)]
    [JsonPropertyName("adapter_id")]
    public string AdapterId { get; init; } = string.Empty;

    /// <summary>
    /// Adapter-local logical scope — the same shape used on the
    /// fetcher-state endpoints (e.g. <c>owner/repo</c> for the GHA
    /// adapter). 1–200 characters, non-whitespace; cap mirrors the
    /// <c>{source-id}</c> path-segment cap on <c>GET</c>/<c>PUT
    /// /api/fetcher/state/{source-id}</c>.
    /// </summary>
    [Required(AllowEmptyStrings = false)]
    [NotWhitespace]
    [StringLength(200, MinimumLength = 1)]
    [JsonPropertyName("source_id")]
    public string SourceId { get; init; } = string.Empty;

    /// <summary>
    /// Provider-reported total budget for the current rate-limit window
    /// (GHA: <c>X-RateLimit-Limit</c>). 1..1_000_000 — a positive budget
    /// is a precondition of the cap math; the upper bound is generous
    /// (typical providers cap at 5_000 / 15_000 / 60_000).
    /// </summary>
    [Range(1, 1_000_000)]
    [JsonPropertyName("upstream_limit")]
    public int UpstreamLimit { get; init; }

    /// <summary>
    /// Provider-reported remaining requests for the current window
    /// (GHA: <c>X-RateLimit-Remaining</c>). 0..1_000_000 — zero is
    /// valid (cap-exhausted upstream); upper bound matches
    /// <see cref="UpstreamLimit"/>'s ceiling.
    /// </summary>
    [Range(0, 1_000_000)]
    [JsonPropertyName("upstream_remaining")]
    public int UpstreamRemaining { get; init; }

    /// <summary>
    /// Provider-reported window reset time, UTC. GHA delivers this as
    /// epoch seconds via <c>X-RateLimit-Reset</c>; the adapter converts
    /// to UTC <see cref="DateTime"/> before sending.
    ///
    /// <para>Nullable so an omitted JSON key materialises as <c>null</c>
    /// instead of silently defaulting to <c>0001-01-01T00:00:00</c>; the
    /// Write handler performs a manual presence check before the
    /// DataAnnotations pipeline runs and surfaces 422 on null. Downstream
    /// code (cache, response shape) unwraps to non-nullable
    /// <see cref="DateTime"/> after the presence check.</para>
    /// </summary>
    [JsonPropertyName("upstream_reset_at")]
    public DateTime? UpstreamResetAt { get; init; }

    /// <summary>
    /// Fetcher-resolved absolute cap for the current window — the output
    /// of <c>RateLimitResolver.Resolve</c> with the upstream limit just
    /// observed. 0..1_000_000 (0 means "no observation yet"; positive
    /// means "operator opted into governance").
    /// </summary>
    [Range(0, 1_000_000)]
    [JsonPropertyName("self_imposed_cap")]
    public int SelfImposedCap { get; init; }

    /// <summary>
    /// Observed upstream usage = <c>UpstreamLimit − UpstreamRemaining</c>
    /// (CR-0011 D3 — wire field is the upstream-observed value, NOT a
    /// fetcher-side counter that would drift on restart). 0..1_000_000.
    /// </summary>
    [Range(0, 1_000_000)]
    [JsonPropertyName("upstream_used")]
    public int UpstreamUsed { get; init; }

    /// <summary>
    /// Fetcher wall-clock at the moment of observation, UTC. Sent so the
    /// backend / SPA can reason about staleness without depending on
    /// server-side clock-skew correction.
    ///
    /// <para>Nullable for the same reason as
    /// <see cref="UpstreamResetAt"/> — System.Text.Json silently defaults
    /// a missing non-nullable <see cref="DateTime"/> key to
    /// <c>0001-01-01T00:00:00</c>, defeating <c>[Required]</c>. The Write
    /// handler's manual presence check rejects null with 422 before
    /// DataAnnotations validation runs.</para>
    /// </summary>
    [JsonPropertyName("observed_at")]
    public DateTime? ObservedAt { get; init; }
}

/// <summary>
/// One snapshot returned inside <see cref="FetcherUsageSnapshotsResponse"/>
/// — every wire field from <see cref="FetcherUsageSnapshotRequest"/> echoed
/// back verbatim plus the server-stamped <see cref="ReceivedAt"/>.
///
/// <para><see cref="ReceivedAt"/> is the API-host wall-clock at the moment
/// the matching <c>POST /api/fetcher/usage</c> call landed. Lets the SPA
/// stale-out the cluster after <c>2 × poll_interval</c> without depending
/// on the SSE wire (CR-0011 § 3b).</para>
/// </summary>
public sealed record FetcherUsageSnapshotResponse
{
    [JsonPropertyName("adapter_id")]
    public string AdapterId { get; init; } = string.Empty;

    [JsonPropertyName("source_id")]
    public string SourceId { get; init; } = string.Empty;

    [JsonPropertyName("upstream_limit")]
    public int UpstreamLimit { get; init; }

    [JsonPropertyName("upstream_remaining")]
    public int UpstreamRemaining { get; init; }

    [JsonPropertyName("upstream_reset_at")]
    public DateTime UpstreamResetAt { get; init; }

    [JsonPropertyName("self_imposed_cap")]
    public int SelfImposedCap { get; init; }

    [JsonPropertyName("upstream_used")]
    public int UpstreamUsed { get; init; }

    [JsonPropertyName("observed_at")]
    public DateTime ObservedAt { get; init; }

    /// <summary>
    /// Backend wall-clock at the moment the matching
    /// <c>POST /api/fetcher/usage</c> landed (UTC). Always serialised with
    /// a trailing <c>Z</c>.
    /// </summary>
    [JsonPropertyName("received_at")]
    public DateTime ReceivedAt { get; init; }
}

/// <summary>
/// Wrapper for <c>GET /api/fetcher/usage</c> (CR-0011 § 3b — Read
/// surface). One element per <c>(adapter_id, source_id)</c> the backend
/// has ever seen a push for; on cold start (or post-restart before the
/// next fetcher tick) the <see cref="Snapshots"/> array is empty — the
/// endpoint never 404s (CR-0011 explicit: "Empty array when the fetcher
/// has not pushed yet — never 404").
/// </summary>
public sealed record FetcherUsageSnapshotsResponse
{
    [JsonPropertyName("snapshots")]
    public IReadOnlyList<FetcherUsageSnapshotResponse> Snapshots { get; init; }
        = Array.Empty<FetcherUsageSnapshotResponse>();
}
