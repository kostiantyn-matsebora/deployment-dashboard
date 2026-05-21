using Dashboard.Shared.Dto;

namespace Dashboard.Fetcher.Abstractions;

/// <summary>
/// One page of events returned by <see cref="ICiCdAdapter.FetchPageAsync"/>.
/// Mirrors ADR-0004 Decision 4 verbatim — with the additive CR-0011
/// extension surfacing the upstream rate-limit observation on the same
/// envelope as the events + cursor (ADR-0004 Decision 4 addendum;
/// CR-0011 Open trade-off (i) Option A).
///
/// <para><see cref="NewCursor"/> is returned even when <see cref="Events"/>
/// is empty — this advances the watermark past idle periods so the next
/// poll does not re-scan the same window.</para>
///
/// <para>When <see cref="HasMore"/> is <c>true</c> the host re-invokes
/// <see cref="ICiCdAdapter.FetchPageAsync"/> immediately within the same
/// poll tick (bounded by a per-tick safety ceiling) — used to drain
/// catch-up backlog after a long idle.</para>
///
/// <para><see cref="RateLimit"/> is the adapter's most-recent rate-limit
/// observation parsed from the upstream response headers (CR-0011 § 3a).
/// Nullable so adapters whose upstream API does not expose a rate-limit
/// window (or whose header parse failed) can omit it cleanly — the host's
/// leaky-bucket gate skips ticks with <c>null</c> here. Default
/// <c>null</c> preserves source compatibility for every existing
/// <c>new FetchPage(events, cursor, hasMore)</c> call-site.</para>
/// </summary>
public sealed record FetchPage(
    IReadOnlyList<DeploymentEventRequest> Events,
    string NewCursor,
    bool HasMore,
    RateLimitObservation? RateLimit = null);
