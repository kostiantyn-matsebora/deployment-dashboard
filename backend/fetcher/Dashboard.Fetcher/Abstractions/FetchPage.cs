using Dashboard.Shared.Dto;

namespace Dashboard.Fetcher.Abstractions;

/// <summary>
/// One page of events returned by <see cref="ICiCdAdapter.FetchPageAsync"/>.
/// Mirrors ADR-0004 Decision 4 verbatim.
///
/// <para><see cref="NewCursor"/> is returned even when <see cref="Events"/>
/// is empty — this advances the watermark past idle periods so the next
/// poll does not re-scan the same window.</para>
///
/// <para>When <see cref="HasMore"/> is <c>true</c> the host re-invokes
/// <see cref="ICiCdAdapter.FetchPageAsync"/> immediately within the same
/// poll tick (bounded by a per-tick safety ceiling) — used to drain
/// catch-up backlog after a long idle.</para>
/// </summary>
public sealed record FetchPage(
    IReadOnlyList<DeploymentEventRequest> Events,
    string NewCursor,
    bool HasMore);
