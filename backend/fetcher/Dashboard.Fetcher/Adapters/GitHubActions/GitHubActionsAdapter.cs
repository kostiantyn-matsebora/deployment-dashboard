using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Adapters.GitHubActions.Models;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Adapters.GitHubActions;

/// <summary>
/// MVP CI/CD adapter targeting the GitHub Actions REST API
/// (CR-0009 § 3d — IN scope; ADO / Jenkins / GitLab / CircleCI deferred).
///
/// <para>Strategy: poll
/// <c>GET /repos/{owner}/{repo}/deployments?per_page={n}</c>
/// (results returned newest-first by the GHA API), filter out anything at
/// or below the highest seen <c>deployment.id</c> from the cursor, then for
/// every remaining deployment fetch its latest status via
/// <c>GET /repos/{owner}/{repo}/deployments/{id}/statuses?per_page=1</c> to
/// resolve the lifecycle state. Cursor = largest <c>deployment.id</c> seen
/// in the current page.</para>
///
/// <para><strong>Rate-limit handling:</strong> on GHA <c>403</c>/<c>429</c>
/// responses, the adapter returns an empty page with the unchanged cursor
/// and <c>HasMore == false</c>; the host's next poll tick re-tries. We do
/// not parse <c>X-RateLimit-Reset</c> in MVP — at the default 30 s poll
/// interval, GHA's 5000-req/h budget is far from binding for a single
/// adapter.</para>
///
/// <para><strong>Source-id contract:</strong> <c>sourceId</c> must be
/// <c>owner/repo</c> (single slash). Other shapes return an empty page and
/// log at warning level.</para>
/// </summary>
public sealed class GitHubActionsAdapter : ICiCdAdapter
{
    /// <summary>Public adapter identity (used as <c>X-Progress-Reporter</c> suffix).</summary>
    public string AdapterId => "github-actions";

    /// <summary>Named HttpClient key the host registers via <c>AddHttpClient</c>.</summary>
    public const string HttpClientName = "github-actions";

    private readonly IHttpClientFactory _httpFactory;
    private readonly ILogger<GitHubActionsAdapter> _logger;

    public GitHubActionsAdapter(IHttpClientFactory httpFactory, ILogger<GitHubActionsAdapter> logger)
    {
        _httpFactory = httpFactory;
        _logger = logger;
    }

    public async Task<FetchPage> FetchPageAsync(
        string sourceId,
        string? cursor,
        int pageSize,
        CancellationToken ct)
    {
        if (!TrySplitOwnerRepo(sourceId, out var owner, out var repo))
        {
            _logger.LogWarning(
                "GHA adapter received malformed source-id '{SourceId}' (expected 'owner/repo'); skipping page",
                sourceId);
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }

        var watermark = GitHubActionsCursor.Parse(cursor);
        // Cap the page size for the GHA per_page parameter — GHA's hard
        // ceiling is 100 regardless of what we ask for.
        var perPage = Math.Clamp(pageSize, 1, 100);

        using var http = _httpFactory.CreateClient(HttpClientName);
        var listUrl = $"repos/{owner}/{repo}/deployments?per_page={perPage}";

        HttpResponseMessage listResp;
        try
        {
            listResp = await http.GetAsync(listUrl, ct);
        }
        catch (HttpRequestException ex)
        {
            // Transient network failure — resilience handler already retried
            // for us; surface as an empty no-op page so the host doesn't
            // advance the cursor (ADR-0004 — partial-page failure must NOT
            // advance the cursor).
            _logger.LogWarning(ex, "GHA list deployments failed for {SourceId}", sourceId);
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }

        if (IsRateLimited(listResp))
        {
            _logger.LogWarning(
                "GHA rate-limit on list deployments for {SourceId} (status {Status}); backing off until next tick",
                sourceId, (int)listResp.StatusCode);
            listResp.Dispose();
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }

        if (!listResp.IsSuccessStatusCode)
        {
            _logger.LogError(
                "GHA list deployments returned {Status} for {SourceId}; not advancing cursor",
                (int)listResp.StatusCode, sourceId);
            listResp.Dispose();
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }

        List<GitHubDeploymentDto>? deployments;
        try
        {
            deployments = await listResp.Content.ReadFromJsonAsync<List<GitHubDeploymentDto>>(cancellationToken: ct);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "GHA list deployments returned unparseable JSON for {SourceId}", sourceId);
            listResp.Dispose();
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }
        finally
        {
            listResp.Dispose();
        }

        if (deployments is null || deployments.Count == 0)
        {
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false);
        }

        // Filter to entries strictly above the watermark; preserve GHA's
        // newest-first order from the API for the cursor calculation, then
        // emit events in chronological (oldest-first) order so the matrix
        // sees the lifecycle correctly.
        var fresh = deployments.Where(d => d.Id > watermark).OrderBy(d => d.Id).ToList();
        if (fresh.Count == 0)
        {
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), GitHubActionsCursor.Format(watermark), HasMore: false);
        }

        var newWatermark = fresh.Max(d => d.Id);
        var events = new List<DeploymentEventRequest>(fresh.Count);

        foreach (var dep in fresh)
        {
            var status = await FetchLatestStatusAsync(http, owner, repo, dep.Id, ct);
            // No status yet? Treat as in-progress per the conservative MVP
            // mapping (a deployment with no statuses has been queued but not
            // resolved). Adapter doesn't drop on this — the slot will get a
            // success/failure on the next poll once GHA records one.
            var lifecycle = status is null
                ? DeploymentStatus.InProgress
                : MapGitHubStateToLifecycle(status.State);

            events.Add(new DeploymentEventRequest
            {
                DeploymentId = $"gha-{dep.Id}",
                Service = repo,
                Environment = string.IsNullOrWhiteSpace(dep.Environment) ? "unknown" : dep.Environment,
                Version = !string.IsNullOrWhiteSpace(dep.Sha)
                    ? dep.Sha.Length > 7 ? dep.Sha[..7] : dep.Sha
                    : dep.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Status = lifecycle,
                RunUrl = status?.LogUrl
                       ?? status?.TargetUrl
                       ?? $"https://github.com/{owner}/{repo}/deployments",
                RunNumber = dep.Id,
                Actor = dep.Creator?.Login ?? "system",
                Ref = dep.Ref,
                Sha = dep.Sha,
            });
        }

        // hasMore = the page was full → there are likely more events past it;
        // host re-invokes immediately to drain.
        var hasMore = deployments.Count >= perPage;
        return new FetchPage(events, GitHubActionsCursor.Format(newWatermark), hasMore);
    }

    private async Task<GitHubDeploymentStatusDto?> FetchLatestStatusAsync(
        HttpClient http, string owner, string repo, long deploymentId, CancellationToken ct)
    {
        var url = $"repos/{owner}/{repo}/deployments/{deploymentId}/statuses?per_page=1";
        HttpResponseMessage resp;
        try
        {
            resp = await http.GetAsync(url, ct);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "GHA fetch latest status failed for deployment {DeploymentId}", deploymentId);
            return null;
        }

        if (IsRateLimited(resp) || !resp.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "GHA fetch latest status for deployment {DeploymentId} returned {Status}",
                deploymentId, (int)resp.StatusCode);
            resp.Dispose();
            return null;
        }

        try
        {
            var statuses = await resp.Content.ReadFromJsonAsync<List<GitHubDeploymentStatusDto>>(cancellationToken: ct);
            return statuses is { Count: > 0 } ? statuses[0] : null;
        }
        catch (JsonException)
        {
            return null;
        }
        finally
        {
            resp.Dispose();
        }
    }

    private static bool TrySplitOwnerRepo(string sourceId, out string owner, out string repo)
    {
        owner = string.Empty;
        repo = string.Empty;
        if (string.IsNullOrWhiteSpace(sourceId)) return false;
        var idx = sourceId.IndexOf('/');
        if (idx <= 0 || idx == sourceId.Length - 1) return false;
        // Reject multi-slash forms — GHA repo paths are exactly owner/repo.
        if (sourceId.IndexOf('/', idx + 1) >= 0) return false;
        owner = sourceId[..idx];
        repo = sourceId[(idx + 1)..];
        return true;
    }

    private static bool IsRateLimited(HttpResponseMessage resp)
    {
        if (resp.StatusCode == HttpStatusCode.TooManyRequests) return true;
        // GHA returns 403 for both authz failure and rate-limit hits; the
        // distinguishing header is X-RateLimit-Remaining=0.
        if (resp.StatusCode == HttpStatusCode.Forbidden &&
            resp.Headers.TryGetValues("X-RateLimit-Remaining", out var values) &&
            values.FirstOrDefault() == "0")
        {
            return true;
        }
        return false;
    }

    /// <summary>
    /// Map a GitHub deployment status state to the dashboard's lifecycle.
    /// GHA states: <c>error</c>, <c>failure</c>, <c>inactive</c>, <c>in_progress</c>,
    /// <c>queued</c>, <c>pending</c>, <c>success</c>.
    /// </summary>
    private static string MapGitHubStateToLifecycle(string ghState) => ghState switch
    {
        "success" => DeploymentStatus.Success,
        "failure" or "error" => DeploymentStatus.Failure,
        _ => DeploymentStatus.InProgress, // in_progress / queued / pending / inactive / anything new
    };
}
