using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
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
/// <para><strong>Correlation edges (issue #19, ADR-0007).</strong> After
/// the status fetch, the adapter recovers two flavours of
/// <c>parent_deployments</c> edges and emits them on
/// <see cref="DeploymentEventRequest.ParentDeployments"/>:</para>
/// <list type="bullet">
///   <item><b>Intra-run <c>needs:</c></b> — for each deployment whose
///   status URL parses to a <c>(run_id, job_id)</c> pair, the adapter
///   fetches the run's jobs + workflow YAML once per distinct run id
///   (cached for the fetch cycle), maps <c>jobs.&lt;name&gt;.needs</c>
///   to sibling deployments emitted from the same run, and emits edges
///   where the parent job also produced a deployment in this cycle's
///   batch.</item>
///   <item><b>Per-env predecessor</b> — within the same fetch cycle,
///   each deployment's predecessor in its <c>(service, environment)</c>
///   pair is the deployment immediately below it in id-order in the same
///   list response. Stateless implementation (no new cursor surface):
///   the global list call already returns at-or-below-watermark entries
///   we'd otherwise discard; we keep them strictly as predecessor
///   candidates. When no candidate is in the page (env's prior
///   deployment paged out), the edge degrades to empty for that
///   deployment -- locked-in choice documented at the
///   <see cref="ResolvePerEnvPredecessor"/> site (Option B fallback per
///   issue #19 "stateless-constraint implementation question").</item>
/// </list>
///
/// <para><b>Silent-degrade contract.</b> Any failure of the
/// jobs / runs / contents APIs or YAML parse → no intra-run edges from
/// that workflow, INFO log once, fetch cycle continues. Hard failure of
/// the cycle is reserved for cursor / auth errors only.</para>
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

        // CR-0011: pull rate-limit headers from the LIST response — present
        // on both success and rate-limit-hit paths per GHA REST API.
        var (deployments, rateLimit) = await TryListDeploymentsAsync(http, listUrl, sourceId, ct);
        if (deployments is null)
        {
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false, rateLimit);
        }

        if (deployments.Count == 0)
        {
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), cursor ?? string.Empty, HasMore: false, rateLimit);
        }

        // Filter to entries strictly above the watermark; preserve GHA's
        // newest-first order from the API for the cursor calculation, then
        // emit events in chronological (oldest-first) order so the matrix
        // sees the lifecycle correctly.
        var fresh = deployments.Where(d => d.Id > watermark).OrderBy(d => d.Id).ToList();
        if (fresh.Count == 0)
        {
            return new FetchPage(Array.Empty<DeploymentEventRequest>(), GitHubActionsCursor.Format(watermark), HasMore: false, rateLimit);
        }

        var newWatermark = fresh.Max(d => d.Id);

        // ───── Pass 1: status + run-host parse per deployment ─────
        // We can't emit events yet because the intra-run edge resolution
        // (Pass 2a) needs to see every deployment in this batch first to
        // build the {(run_id, job_id) → deployment_id} lookup.
        var stage = new List<StagedDeployment>(fresh.Count);
        foreach (var dep in fresh)
        {
            var status = await FetchLatestStatusAsync(http, owner, repo, dep.Id, ct);
            var lifecycle = status is null
                ? DeploymentStatus.InProgress
                : MapGitHubStateToLifecycle(status.State);
            var statusUrl = status?.LogUrl ?? status?.TargetUrl;
            RunHostCoordinates? coords = null;
            if (StatusUrlParser.TryParse(statusUrl, out var rhOwner, out var rhRepo, out var runId, out var jobId))
            {
                coords = new RunHostCoordinates(rhOwner, rhRepo, runId, jobId);
            }

            stage.Add(new StagedDeployment(
                dep,
                Status: status,
                Lifecycle: lifecycle,
                RunHost: coords));
        }

        // ───── Pass 2a: intra-run `needs:` edges ─────
        // Build the index {(runId, jobId) → deploymentId} and the secondary
        // {(runId, jobName) → deploymentId}; load run metadata + workflow
        // YAML lazily, one fetch per distinct run id, cached for the
        // remainder of this method (no cross-cycle caching by design --
        // ADR-0007: per-cycle scope only).
        var cache = new FetchCycleCache();
        var jobIdIndex = new Dictionary<(long RunId, long JobId), string>();
        var jobNameIndex = new Dictionary<(long RunId, string JobName), string>(
            new RunJobNameKeyComparer());
        foreach (var s in stage)
        {
            if (s.RunHost is null || s.RunHost.JobId is null) continue;
            var depEventId = FormatDeploymentId(s.Deployment.Id);
            jobIdIndex[(s.RunHost.RunId, s.RunHost.JobId.Value)] = depEventId;
            // Look up the job's name from the cached jobs response so the
            // index can also be queried by name -- this is what the YAML's
            // `needs:` clause references.
            var meta = await EnsureWorkflowMetadataAsync(http, s.RunHost, cache, ct);
            if (meta is not null && meta.JobsById.TryGetValue(s.RunHost.JobId.Value, out var jobName))
            {
                jobNameIndex[(s.RunHost.RunId, jobName)] = depEventId;
            }
        }

        // ───── Pass 2b: per-env predecessor candidates ─────
        // Use deployments from the SAME list response as predecessor
        // candidates per env. Newest-first list ordering means the
        // candidate for env X's first new event is the highest-id
        // deployment ≤ watermark with environment == X.
        //
        // Locked-in choice: this is Option A "for free" within a single
        // page; when the env's prior deployment is NOT in the same page
        // (e.g. the page was filled by newer deployments in other envs),
        // we degrade to Option B (no predecessor for the first new event
        // of that env this cycle). Acceptable per issue #19's "stateless-
        // constraint implementation question" — first-deployment-in-env
        // acceptance criterion is preserved (empty array, not null).
        var perEnvPredecessor = BuildPerEnvPredecessorIndex(deployments, watermark);

        // ───── Emission: combine both edge types ─────
        // Track the last emitted deployment id per env so that successive
        // new events in the same env in the same batch chain naturally
        // (no extra HTTP call required).
        var lastEmittedPerEnv = new Dictionary<string, string>(StringComparer.Ordinal);
        var events = new List<DeploymentEventRequest>(fresh.Count);
        foreach (var s in stage)
        {
            var envKey = ResolveEnvironmentKey(s.Deployment.Environment);
            var depEventId = FormatDeploymentId(s.Deployment.Id);

            // Intra-run edges from `needs:`
            var intraRunParents = await ResolveIntraRunParentsAsync(http, s, jobNameIndex, cache, ct);

            // Per-env predecessor edge
            var predecessorId = ResolvePerEnvPredecessor(envKey, lastEmittedPerEnv, perEnvPredecessor);

            // Combine + de-duplicate (preserve first-seen order)
            var parents = CombineEdges(intraRunParents, predecessorId);

            events.Add(new DeploymentEventRequest
            {
                DeploymentId = depEventId,
                Service = repo,
                Environment = envKey,
                Version = !string.IsNullOrWhiteSpace(s.Deployment.Sha)
                    ? s.Deployment.Sha.Length > 7 ? s.Deployment.Sha[..7] : s.Deployment.Sha
                    : s.Deployment.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                Status = s.Lifecycle,
                RunUrl = s.Status?.LogUrl
                       ?? s.Status?.TargetUrl
                       ?? $"https://github.com/{owner}/{repo}/deployments",
                RunNumber = s.Deployment.Id,
                Actor = s.Deployment.Creator?.Login ?? "system",
                Ref = s.Deployment.Ref,
                Sha = s.Deployment.Sha,
                ParentDeployments = parents,
            });

            lastEmittedPerEnv[envKey] = depEventId;
        }

        // hasMore = the page was full → there are likely more events past it;
        // host re-invokes immediately to drain.
        var hasMore = deployments.Count >= perPage;
        return new FetchPage(events, GitHubActionsCursor.Format(newWatermark), hasMore, rateLimit);
    }

    /// <summary>
    /// Fetch the deployments list, handling rate-limit / auth / transport
    /// failures via the same "empty no-op page" pattern as the rest of
    /// the adapter (cursor preserved, HasMore=false, host retries next
    /// tick per ADR-0004).
    ///
    /// <para>CR-0011: also parses the upstream rate-limit headers from
    /// the LIST response on BOTH success and rate-limit-hit paths so the
    /// host can drive its self-imposed cap gate without needing a
    /// separate observation surface. Parse failures (missing / malformed
    /// headers) log INFO once and emit <c>null</c> in the second
    /// position; the host then does not gate that tick (matches the
    /// pre-CR-0011 baseline).</para>
    /// </summary>
    private async Task<(List<GitHubDeploymentDto>? Deployments, RateLimitObservation? RateLimit)> TryListDeploymentsAsync(
        HttpClient http, string listUrl, string sourceId, CancellationToken ct)
    {
        HttpResponseMessage listResp;
        try
        {
            listResp = await http.GetAsync(listUrl, ct);
        }
        catch (HttpRequestException ex)
        {
            _logger.LogWarning(ex, "GHA list deployments failed for {SourceId}", sourceId);
            return (null, null);
        }

        // Always attempt to parse the rate-limit observation FIRST so the
        // host gets the up-to-date budget even on rate-limit-hit / error
        // paths (CR-0011 § 3a — push runs even on cap-reached ticks).
        var rateLimit = TryParseRateLimit(listResp, sourceId);

        if (IsRateLimited(listResp))
        {
            _logger.LogWarning(
                "GHA rate-limit on list deployments for {SourceId} (status {Status}); backing off until next tick",
                sourceId, (int)listResp.StatusCode);
            listResp.Dispose();
            return (null, rateLimit);
        }

        if (!listResp.IsSuccessStatusCode)
        {
            _logger.LogError(
                "GHA list deployments returned {Status} for {SourceId}; not advancing cursor",
                (int)listResp.StatusCode, sourceId);
            listResp.Dispose();
            return (null, rateLimit);
        }

        try
        {
            var deployments = await listResp.Content.ReadFromJsonAsync<List<GitHubDeploymentDto>>(cancellationToken: ct);
            return (deployments ?? new List<GitHubDeploymentDto>(0), rateLimit);
        }
        catch (JsonException ex)
        {
            _logger.LogError(ex, "GHA list deployments returned unparseable JSON for {SourceId}", sourceId);
            return (null, rateLimit);
        }
        finally
        {
            listResp.Dispose();
        }
    }

    /// <summary>
    /// CR-0011 § 3a — parse <c>X-RateLimit-Limit</c> +
    /// <c>X-RateLimit-Remaining</c> (ints) + <c>X-RateLimit-Reset</c>
    /// (epoch seconds → UTC <see cref="DateTime"/>) from any GHA
    /// response. Returns <c>null</c> when any header is missing or
    /// malformed; logs at INFO level so the once-per-fetch-cycle
    /// signal lands in the observability stream without flooding.
    /// </summary>
    private RateLimitObservation? TryParseRateLimit(HttpResponseMessage resp, string sourceId)
    {
        if (resp is null) return null;

        if (!TryGetIntHeader(resp, "X-RateLimit-Limit", out var limit) ||
            !TryGetIntHeader(resp, "X-RateLimit-Remaining", out var remaining) ||
            !TryGetIntHeader(resp, "X-RateLimit-Reset", out var resetEpochSeconds))
        {
            _logger.LogInformation(
                "GHA rate-limit headers missing or malformed on response for {SourceId}; usage push will carry prior observation if available",
                sourceId);
            return null;
        }

        DateTime resetAt;
        try
        {
            resetAt = DateTimeOffset.FromUnixTimeSeconds(resetEpochSeconds).UtcDateTime;
        }
        catch (ArgumentOutOfRangeException ex)
        {
            _logger.LogInformation(ex,
                "GHA X-RateLimit-Reset value {Reset} for {SourceId} is outside the valid epoch-seconds range; usage push will carry prior observation",
                resetEpochSeconds, sourceId);
            return null;
        }

        return new RateLimitObservation(
            UpstreamLimit: limit,
            UpstreamRemaining: remaining,
            UpstreamResetAt: resetAt,
            ObservedAt: DateTime.UtcNow);
    }

    private static bool TryGetIntHeader(HttpResponseMessage resp, string headerName, out int value)
    {
        value = 0;
        if (!resp.Headers.TryGetValues(headerName, out var values)) return false;
        var raw = values.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(raw)) return false;
        return int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
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

    /// <summary>
    /// Load (or return cached) workflow metadata for the run: the jobs
    /// list (id ↔ name) and the parsed workflow YAML (job name → needs).
    /// Silent-degrade contract: any failure returns <c>null</c>, the
    /// caller emits no intra-run edges for that run, INFO log once per
    /// run id.
    /// </summary>
    private async Task<WorkflowMetadata?> EnsureWorkflowMetadataAsync(
        HttpClient http, RunHostCoordinates coords, FetchCycleCache cache, CancellationToken ct)
    {
        var key = (coords.Owner, coords.Repo, coords.RunId);
        if (cache.WorkflowMetadata.TryGetValue(key, out var cached)) return cached;

        WorkflowMetadata? metadata = null;
        try
        {
            var runDto = await FetchRunAsync(http, coords.Owner, coords.Repo, coords.RunId, ct);
            if (runDto is null) return CacheAndReturn(null);

            var jobsDto = await FetchRunJobsAsync(http, coords.Owner, coords.Repo, coords.RunId, ct);
            if (jobsDto is null) return CacheAndReturn(null);

            var yamlText = await FetchWorkflowContentsAsync(http, coords.Owner, coords.Repo, runDto.Path, runDto.HeadSha, ct);
            if (yamlText is null) return CacheAndReturn(null);

            var parsed = WorkflowYamlParser.Parse(yamlText);
            var jobsById = jobsDto.Jobs
                .Where(j => !string.IsNullOrEmpty(j.Name))
                .GroupBy(j => j.Id)
                .ToDictionary(g => g.Key, g => g.First().Name);

            metadata = new WorkflowMetadata(jobsById, parsed);
            return CacheAndReturn(metadata);
        }
        catch (Exception ex)
        {
            _logger.LogInformation(ex,
                "GHA needs-recovery silent-skip for run {Owner}/{Repo}/{RunId}: unexpected failure",
                coords.Owner, coords.Repo, coords.RunId);
            return CacheAndReturn(null);
        }

        WorkflowMetadata? CacheAndReturn(WorkflowMetadata? value)
        {
            cache.WorkflowMetadata[key] = value;
            return value;
        }
    }

    private async Task<GitHubWorkflowRunDto?> FetchRunAsync(
        HttpClient http, string owner, string repo, long runId, CancellationToken ct)
    {
        var url = $"repos/{owner}/{repo}/actions/runs/{runId}";
        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode || IsRateLimited(resp))
            {
                _logger.LogInformation(
                    "GHA needs-recovery silent-skip for run {Owner}/{Repo}/{RunId}: GET /actions/runs returned {Status}",
                    owner, repo, runId, (int)resp.StatusCode);
                return null;
            }
            return await resp.Content.ReadFromJsonAsync<GitHubWorkflowRunDto>(cancellationToken: ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            _logger.LogInformation(ex,
                "GHA needs-recovery silent-skip for run {Owner}/{Repo}/{RunId}: GET /actions/runs failed",
                owner, repo, runId);
            return null;
        }
    }

    private async Task<GitHubRunJobsDto?> FetchRunJobsAsync(
        HttpClient http, string owner, string repo, long runId, CancellationToken ct)
    {
        var url = $"repos/{owner}/{repo}/actions/runs/{runId}/jobs";
        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode || IsRateLimited(resp))
            {
                _logger.LogInformation(
                    "GHA needs-recovery silent-skip for run {Owner}/{Repo}/{RunId}: GET /actions/runs/{RunId}/jobs returned {Status}",
                    owner, repo, runId, runId, (int)resp.StatusCode);
                return null;
            }
            return await resp.Content.ReadFromJsonAsync<GitHubRunJobsDto>(cancellationToken: ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            _logger.LogInformation(ex,
                "GHA needs-recovery silent-skip for run {Owner}/{Repo}/{RunId}: GET /actions/runs/{RunId}/jobs failed",
                owner, repo, runId, runId);
            return null;
        }
    }

    private async Task<string?> FetchWorkflowContentsAsync(
        HttpClient http, string owner, string repo, string path, string headSha, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(headSha))
        {
            return null;
        }
        var url = $"repos/{owner}/{repo}/contents/{path}?ref={headSha}";
        try
        {
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode || IsRateLimited(resp))
            {
                _logger.LogInformation(
                    "GHA needs-recovery silent-skip for run {Owner}/{Repo} path={Path}@{Sha}: GET /contents returned {Status}",
                    owner, repo, path, headSha, (int)resp.StatusCode);
                return null;
            }
            var dto = await resp.Content.ReadFromJsonAsync<GitHubContentsDto>(cancellationToken: ct);
            if (dto is null || string.IsNullOrEmpty(dto.Content))
            {
                _logger.LogInformation(
                    "GHA needs-recovery silent-skip for run {Owner}/{Repo} path={Path}@{Sha}: empty contents body",
                    owner, repo, path, headSha);
                return null;
            }

            // GHA wraps base64 with newlines every 60 chars; Convert.FromBase64String
            // tolerates internal whitespace via FromBase64String semantics on .NET 10.
            try
            {
                var bytes = Convert.FromBase64String(dto.Content);
                return Encoding.UTF8.GetString(bytes);
            }
            catch (FormatException ex)
            {
                _logger.LogInformation(ex,
                    "GHA needs-recovery silent-skip for run {Owner}/{Repo} path={Path}@{Sha}: base64 decode failed",
                    owner, repo, path, headSha);
                return null;
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or JsonException or TaskCanceledException)
        {
            _logger.LogInformation(ex,
                "GHA needs-recovery silent-skip for run {Owner}/{Repo} path={Path}@{Sha}: GET /contents failed",
                owner, repo, path, headSha);
            return null;
        }
    }

    /// <summary>
    /// Walk the deployment's workflow YAML <c>needs:</c> list and emit
    /// the sibling deployment ids that match. Silent-skip rules apply:
    /// if metadata couldn't be loaded, returns empty; if a named parent
    /// job has no sibling deployment in this batch, that single edge is
    /// dropped (DEBUG log) -- the rest still emit.
    /// </summary>
    private async Task<IReadOnlyList<string>> ResolveIntraRunParentsAsync(
        HttpClient http,
        StagedDeployment s,
        IReadOnlyDictionary<(long RunId, string JobName), string> jobNameIndex,
        FetchCycleCache cache,
        CancellationToken ct)
    {
        if (s.RunHost is null) return Array.Empty<string>();
        if (s.RunHost.JobId is null)
        {
            _logger.LogInformation(
                "GHA deployment {DeploymentId}: status URL lacks /job/{{id}} segment; skipping intra-run needs edges",
                s.Deployment.Id);
            return Array.Empty<string>();
        }

        var metadata = await EnsureWorkflowMetadataAsync(http, s.RunHost, cache, ct);
        if (metadata is null) return Array.Empty<string>();

        if (!metadata.JobsById.TryGetValue(s.RunHost.JobId.Value, out var thisJobName))
        {
            // The deployment's job_id wasn't in the run's jobs list — odd
            // but possible if GHA garbage-collected an old re-run job.
            return Array.Empty<string>();
        }

        var needs = metadata.WorkflowYaml.GetNeedsFor(thisJobName);
        if (needs.Count == 0) return Array.Empty<string>();

        var parents = new List<string>(needs.Count);
        foreach (var parentJobName in needs)
        {
            if (jobNameIndex.TryGetValue((s.RunHost.RunId, parentJobName), out var parentDepId))
            {
                parents.Add(parentDepId);
            }
            else
            {
                _logger.LogDebug(
                    "GHA deployment {DeploymentId}: parent job {ParentJob} in `needs:` did not produce a deployment in this batch; dropping edge",
                    s.Deployment.Id, parentJobName);
            }
        }
        return parents;
    }

    /// <summary>
    /// Build the per-env predecessor index from the raw list response,
    /// using deployments at-or-below the watermark as candidates. The
    /// index value is the largest at-or-below deployment id per env --
    /// which is the predecessor of the first new event in that env.
    /// </summary>
    private static Dictionary<string, long> BuildPerEnvPredecessorIndex(
        IReadOnlyList<GitHubDeploymentDto> page, long watermark)
    {
        var byEnv = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var d in page)
        {
            if (d.Id > watermark) continue; // only at-or-below entries count as predecessor candidates
            var env = ResolveEnvironmentKey(d.Environment);
            if (!byEnv.TryGetValue(env, out var existing) || d.Id > existing)
            {
                byEnv[env] = d.Id;
            }
        }
        return byEnv;
    }

    /// <summary>
    /// Pick the per-env predecessor for the next event in env <paramref name="envKey"/>.
    /// First preference: the prior event already emitted in this batch
    /// for the same env. Second preference: the largest at-or-below
    /// deployment for that env from the raw list page (Option A "for
    /// free" — same response, no extra HTTP call). When neither exists
    /// (first-time env, or env's prior deployment paged out), returns
    /// <c>null</c> → empty array, NOT null on the wire.
    /// </summary>
    private static string? ResolvePerEnvPredecessor(
        string envKey,
        IReadOnlyDictionary<string, string> lastEmittedPerEnv,
        IReadOnlyDictionary<string, long> perEnvPredecessor)
    {
        if (lastEmittedPerEnv.TryGetValue(envKey, out var prior)) return prior;
        if (perEnvPredecessor.TryGetValue(envKey, out var priorId)) return FormatDeploymentId(priorId);
        return null;
    }

    /// <summary>
    /// Union the two edge sources, preserving order and de-duplicating.
    /// Returns an empty array (never null) when both sources are empty.
    /// </summary>
    private static IReadOnlyList<string> CombineEdges(
        IReadOnlyList<string> intraRunParents, string? predecessorId)
    {
        if (intraRunParents.Count == 0 && predecessorId is null)
        {
            // Empty array (never null) per issue #19 acceptance criterion
            // "first deployment in an env (no predecessor) → empty
            // ParentDeployments array, not null".
            return Array.Empty<string>();
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var result = new List<string>(intraRunParents.Count + 1);
        foreach (var p in intraRunParents)
        {
            if (seen.Add(p)) result.Add(p);
        }
        if (predecessorId is not null && seen.Add(predecessorId))
        {
            result.Add(predecessorId);
        }
        return result;
    }

    private static string FormatDeploymentId(long gitHubDeploymentId)
        => $"gha-{gitHubDeploymentId.ToString(System.Globalization.CultureInfo.InvariantCulture)}";

    private static string ResolveEnvironmentKey(string? environment)
        => string.IsNullOrWhiteSpace(environment) ? "unknown" : environment;

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

    // ──────────────────────────────────────────────────────────────────
    // Internal types — kept private so the only public surface is
    // ICiCdAdapter + the constructor (per ADR-0004 Decision 4).
    // ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Pass-1 intermediate record. Holds everything we know about a
    /// fresh deployment before we've resolved its edges -- the status
    /// fetch, the lifecycle mapping, and the parsed run-host coords (if
    /// any).
    /// </summary>
    private sealed record StagedDeployment(
        GitHubDeploymentDto Deployment,
        GitHubDeploymentStatusDto? Status,
        string Lifecycle,
        RunHostCoordinates? RunHost);

    /// <summary>
    /// Per-cycle cache for the run-metadata bundle (jobs + parsed YAML).
    /// In-memory only; lifetime is the duration of a single
    /// <see cref="FetchPageAsync"/> call. ADR-0007 + issue #19 explicitly
    /// reject cross-cycle caching to keep the no-persistent-state
    /// posture (NFR-05).
    /// </summary>
    private sealed class FetchCycleCache
    {
        public Dictionary<(string Owner, string Repo, long RunId), WorkflowMetadata?> WorkflowMetadata { get; } = new();
    }

    /// <summary>
    /// Bundled per-run metadata: the {jobId → jobName} map (from
    /// <c>/actions/runs/{id}/jobs</c>) and the parsed workflow YAML
    /// (from <c>/contents/{path}?ref={sha}</c>).
    /// </summary>
    private sealed record WorkflowMetadata(
        IReadOnlyDictionary<long, string> JobsById,
        ParsedWorkflowYaml WorkflowYaml);

    /// <summary>
    /// Composite-key comparer for <c>(runId, jobName)</c> tuples — keeps
    /// the dictionary lookups ordinal-string on the job name half (GHA
    /// job names are case-sensitive YAML identifiers).
    /// </summary>
    private sealed class RunJobNameKeyComparer : IEqualityComparer<(long RunId, string JobName)>
    {
        public bool Equals((long RunId, string JobName) x, (long RunId, string JobName) y)
            => x.RunId == y.RunId && string.Equals(x.JobName, y.JobName, StringComparison.Ordinal);

        public int GetHashCode((long RunId, string JobName) obj)
            => HashCode.Combine(obj.RunId, StringComparer.Ordinal.GetHashCode(obj.JobName));
    }
}
