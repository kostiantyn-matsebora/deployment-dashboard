namespace Dashboard.Fetcher.Abstractions;

/// <summary>
/// Plug-in contract for a CI/CD-tool pull-mode adapter (CR-0009 + ADR-0004
/// Decision 4). One implementation per supported tool — each one is loaded by
/// the host composition root and driven by the shared <c>FetcherWorker</c>.
///
/// <para><strong>Adapter responsibilities:</strong></para>
/// <list type="bullet">
///   <item>One CI/CD-tool API call (or several, for multi-step fetches like
///   GHA's deployments + statuses).</item>
///   <item>Translate the tool's native event shape into
///   <c>DeploymentEventRequest</c> (reuse the canonical
///   <c>Dashboard.Shared</c> DTOs — no parallel concept).</item>
///   <item>Maintain its own cursor shape, string-serialised
///   (ADR-0004 Decision 2 — backend treats it as opaque).</item>
///   <item>Report <c>HasMore == true</c> when the page was full and the next
///   page is known to exist (so the host can drain catch-up backlog in the
///   same tick).</item>
/// </list>
///
/// <para><strong>Host responsibilities</strong> (NOT the adapter):
/// scheduler / poll cadence, retry + back-off, rate-limit detection, write
/// dispatch (<c>POST /api/deployments</c>), cursor lifecycle (<c>GET</c> /
/// <c>PUT /api/fetcher/state</c>).</para>
/// </summary>
public interface ICiCdAdapter
{
    /// <summary>
    /// Adapter identity — used both as the dictionary key when the host has
    /// multiple adapters loaded and as the default <c>X-Progress-Reporter</c>
    /// suffix. The host composes the default header value as
    /// <c>dashboard-fetcher/{AdapterId}</c> (CR-0009 § 3a recommended namespacing).
    /// </summary>
    string AdapterId { get; }

    /// <summary>
    /// Fetch one page of events from the upstream CI/CD tool.
    /// </summary>
    /// <param name="sourceId">Adapter-local logical scope (e.g. <c>owner/repo</c>
    /// for the GHA adapter). Opaque to the host beyond logging.</param>
    /// <param name="cursor">Opaque cursor blob from the previous successful round,
    /// or <c>null</c> on first fetch (the host translates a Write-API 404 into
    /// <c>null</c> so adapters never see the HTTP-level signal).</param>
    /// <param name="pageSize">Bounded by <c>INITIAL_FETCH_LIMIT</c> on the first
    /// fetch; per-adapter "natural page size" thereafter.</param>
    /// <param name="ct">Standard cancellation propagation.</param>
    Task<FetchPage> FetchPageAsync(
        string sourceId,
        string? cursor,
        int pageSize,
        CancellationToken ct);
}
