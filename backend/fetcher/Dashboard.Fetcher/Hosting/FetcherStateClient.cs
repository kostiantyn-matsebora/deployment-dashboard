using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Typed HTTP client wrapper for the three Write-API calls the fetcher
/// makes (CR-0009 + ADR-0004):
///
/// <list type="bullet">
///   <item><c>POST /api/deployments</c> — push an event with both
///   <c>X-Api-Key</c> and <c>X-Progress-Reporter</c> headers set.</item>
///   <item><c>GET /api/fetcher/state/{source-id}</c> — read the opaque
///   cursor; 404 surfaced as <c>null</c> per ICiCdAdapter contract.</item>
///   <item><c>PUT /api/fetcher/state/{source-id}</c> — upsert the cursor
///   after a successful round.</item>
/// </list>
///
/// <para>The base address + headers are configured by
/// <c>Dashboard.Fetcher.DependencyInjection.ServiceCollectionExtensions</c>
/// at registration time; this class only knows the URL shapes + body
/// shapes.</para>
/// </summary>
public sealed class FetcherStateClient
{
    public const string HttpClientName = "fetcher-state";
    public const string ApiKeyHeaderName = "X-Api-Key";
    public const string ProgressReporterHeaderName = "X-Progress-Reporter";

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<FetcherStateClient> _logger;

    public FetcherStateClient(IHttpClientFactory httpFactory, ILogger<FetcherStateClient> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    /// <summary>
    /// The same <see cref="IHttpClientFactory"/> used to mint
    /// <see cref="HttpClient"/> instances for every fetcher → backend call
    /// (CR-0011: <see cref="FetcherUsageClient"/> reuses this factory so
    /// the usage push shares the auth + resilience stack configured
    /// once in the composition root). Exposed so the worker can build
    /// peer clients off the same factory without taking another DI hop.
    /// </summary>
    public IHttpClientFactory HttpFactory => _httpFactory;

    /// <summary>
    /// Read the persisted opaque cursor for the given pair. Returns
    /// <c>null</c> when the Write API returns 404 (the adapter then treats
    /// the next fetch as "first fetch — apply INITIAL_FETCH_LIMIT").
    /// Throws on transport / 5xx errors so the caller skips the cycle.
    /// </summary>
    public async Task<string?> GetCursorAsync(string progressReporter, string sourceId, CancellationToken ct)
    {
        using var http = _httpFactory.CreateClient(HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Get, $"api/fetcher/state/{sourceId}");
        req.Headers.Add(ProgressReporterHeaderName, progressReporter);
        using var resp = await http.SendAsync(req, ct);

        if (resp.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        resp.EnsureSuccessStatusCode();

        var body = await resp.Content.ReadFromJsonAsync<FetcherStateResponse>(DashboardJson.Options, ct);
        return body?.Cursor;
    }

    /// <summary>
    /// Upsert the cursor for the given pair. Throws on non-success so the
    /// caller surfaces the failure into its log.
    /// </summary>
    public async Task PutCursorAsync(
        string progressReporter, string sourceId, string cursor, CancellationToken ct)
    {
        using var http = _httpFactory.CreateClient(HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Put, $"api/fetcher/state/{sourceId}");
        req.Headers.Add(ProgressReporterHeaderName, progressReporter);
        req.Content = JsonContent.Create(
            new FetcherStateRequest { Cursor = cursor },
            options: DashboardJson.Options);
        using var resp = await http.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Push one ingest event. Returns <c>true</c> on 201, <c>false</c> on
    /// 409 (duplicate — the row is already there; treat as idempotent
    /// success). 4xx other than 409 → <c>false</c> + warning (caller config
    /// issue). 5xx → throws.
    /// </summary>
    public async Task<bool> PostDeploymentAsync(
        string progressReporter, DeploymentEventRequest evt, CancellationToken ct)
    {
        using var http = _httpFactory.CreateClient(HttpClientName);
        using var req = new HttpRequestMessage(HttpMethod.Post, "api/deployments");
        req.Headers.Add(ProgressReporterHeaderName, progressReporter);
        req.Content = JsonContent.Create(evt, options: DashboardJson.Options);

        using var resp = await http.SendAsync(req, ct);

        switch ((int)resp.StatusCode)
        {
            case 201:
                return true;
            case 409:
                // Idempotent re-push — the row is already there.
                _logger.LogDebug(
                    "POST /api/deployments returned 409 (duplicate) for {DeploymentId} — treating as success",
                    evt.DeploymentId);
                return true;
            case >= 500:
                resp.EnsureSuccessStatusCode(); // throws → caller catches
                return false;
            default:
                _logger.LogWarning(
                    "POST /api/deployments returned {Status} for {DeploymentId}; not retrying",
                    (int)resp.StatusCode, evt.DeploymentId);
                return false;
        }
    }
}
