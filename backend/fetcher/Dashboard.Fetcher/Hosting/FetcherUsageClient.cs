using System.Net.Http.Json;
using Dashboard.Shared.Fetcher;
using Dashboard.Shared.Json;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Typed HTTP client wrapper for <c>POST /api/fetcher/usage</c> (CR-0011
/// § 3b). Sibling to <see cref="FetcherStateClient"/>; shares the same
/// <c>X-Api-Key</c>-bearing <see cref="HttpClient"/> registration so the
/// fetcher composition root configures the resilience + auth pipeline once.
///
/// <para>The worker calls <see cref="PushUsageAsync"/> at the end of
/// every poll tick (even on no-event ticks, even on cap-reached ticks)
/// so the backend's in-memory cache stays fresh on the dashboard's
/// poll cadence (CR-0011 § 3a "push runs on every poll tick").</para>
///
/// <para>Failure posture: a 4xx / 5xx / transport failure is logged at
/// warning level and swallowed — the usage push is best-effort
/// telemetry, NOT a precondition for the next fetch tick. A persistent
/// failure surfaces as a stale cluster on the SPA (CR-0011 § 3d
/// staleness affordance) rather than a hung fetcher.</para>
/// </summary>
public sealed class FetcherUsageClient
{
    /// <summary>
    /// Reuses the same named <see cref="HttpClient"/> as
    /// <see cref="FetcherStateClient"/> — same base URL, same
    /// <c>X-Api-Key</c> header, same resilience handler stack.
    /// </summary>
    public const string HttpClientName = FetcherStateClient.HttpClientName;

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<FetcherUsageClient> _logger;

    public FetcherUsageClient(IHttpClientFactory httpFactory, ILogger<FetcherUsageClient> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    /// <summary>
    /// Push one usage snapshot. Returns <c>true</c> on 200, <c>false</c>
    /// on any non-success path (4xx / 5xx / transport — all logged at
    /// warning level + swallowed). The caller MUST NOT use the return
    /// value to gate the next fetch — usage push is best-effort.
    /// </summary>
    public async Task<bool> PushUsageAsync(
        string progressReporter,
        FetcherUsageSnapshotRequest request,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(request);

        using var http = _httpFactory.CreateClient(HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/fetcher/usage");
        req.Headers.Add(FetcherStateClient.ProgressReporterHeaderName, progressReporter);
        req.Content = JsonContent.Create(request, options: DashboardJson.Options);

        try
        {
            using var resp = await http.SendAsync(req, ct);
            if (resp.IsSuccessStatusCode) return true;

            _logger.LogWarning(
                "POST /api/fetcher/usage returned {Status} for adapter={AdapterId} source-id={SourceId}; usage snapshot dropped",
                (int)resp.StatusCode, request.AdapterId, request.SourceId);
            return false;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            // Swallow + log — best-effort telemetry. The next tick will
            // try again with a fresh observation.
            _logger.LogWarning(ex,
                "POST /api/fetcher/usage failed for adapter={AdapterId} source-id={SourceId}; usage snapshot dropped",
                request.AdapterId, request.SourceId);
            return false;
        }
    }
}
