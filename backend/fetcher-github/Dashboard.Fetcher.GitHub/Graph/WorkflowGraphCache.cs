using System.IO.Compression;
using System.Text;
using Dashboard.Fetcher.GitHub.Models;

namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>
/// LRU cache (≤ 200 entries) for workflow graphs, workflow names, and artifact content (F11).
/// Workflow runs and artifact archives are immutable — no cache invalidation needed.
/// </summary>
public sealed class WorkflowGraphCache
{
    private readonly BoundedLruCache<string, WorkflowGraph?> _graphs = new(200);
    private readonly BoundedLruCache<string, GhWorkflowRun?> _runs = new(200);
    // Caches (owner/repo:workflowId) → workflow name from GET /actions/workflows/{id} (F12 / §5.6.2).
    // Workflow definitions are immutable within a process lifetime — no invalidation needed.
    private readonly BoundedLruCache<string, string?> _workflowNames = new(200);
    private readonly BoundedLruCache<string, string?> _artifacts = new(200);

    /// <summary>
    /// Returns the cached graph, or fetches it via GitHub (§5.6.2).
    ///
    /// Identity is always resolved via <c>GET /repos/{o}/{r}/actions/workflows/{workflow_id}</c>
    /// (Actions:read, no Contents permission required).  The YAML contents fetch
    /// (<c>GET /contents/{path}?ref={sha}</c>) is best-effort for the needs-graph only:
    /// a 403 or any non-2xx returns an empty-subgraph <see cref="WorkflowGraph"/> with the
    /// identity already set — identity is never blocked by the Contents permission (F10 / F12).
    ///
    /// Returns null only when the run itself cannot be fetched (non-2xx on <c>/actions/runs</c>).
    /// Never throws.
    /// </summary>
    public async Task<WorkflowGraph?> GetOrFetchGraphAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        var key = $"{owner}/{repo}:{runId}";
        if (_graphs.TryGet(key, out var cached))
            return cached;

        var graph = await FetchGraphAsync(owner, repo, runId, github, ct);
        _graphs.Set(key, graph);
        return graph;
    }

    /// <summary>
    /// Returns the path and name fields of a run without fetching the full YAML.
    /// Used by callers that only need service-identity resolution and want to avoid
    /// a direct <see cref="GhWorkflowRun"/> type dependency. Returns nulls on non-2xx.
    /// </summary>
    public async Task<(string? Path, string? Name)> GetOrFetchRunInfoAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        var run = await GetOrFetchRunAsync(owner, repo, runId, github, ct);
        return (run?.Path, run?.Name);
    }

    /// <summary>
    /// Returns only the run metadata (path, workflow_id, name, head_sha, conclusion) without
    /// fetching the YAML.  Used during backfill scanning to resolve service identity cheaply —
    /// the YAML is deferred until the deployment is actually kept (F1 / F2).
    /// Returns null on non-2xx — never throws.
    /// </summary>
    public async Task<GhWorkflowRun?> GetOrFetchRunAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        var key = $"{owner}/{repo}:{runId}";

        // A run's identity fields (path, name, head_sha) are immutable, but its
        // `conclusion` is null while the run is in flight and is only set once it
        // completes. Status refinement reads `conclusion` to detect cancellation
        // (GithubActionsAdapter.ResolveFailureStatusAsync), so a run cached mid-flight
        // (non-null run, null conclusion) MUST be re-fetched — otherwise a later
        // cancellation is missed and the deployment stays `failure`. Reuse the cache
        // only for completed runs (conclusion present) or negative results (null).
        if (_runs.TryGet(key, out var cached) && (cached is null || cached.Conclusion is not null))
            return cached;

        var run = await FetchRunAsync(owner, repo, runId, github, ct);
        _runs.Set(key, run);
        return run;
    }

    /// <summary>
    /// Returns the workflow name from <c>GET /repos/{owner}/{repo}/actions/workflows/{workflowId}</c>.
    /// Cached per <c>({owner}/{repo}:{workflowId})</c>.
    /// Returns null when <paramref name="workflowId"/> is 0 (unset) or the endpoint returns non-2xx.
    /// Never throws.
    /// </summary>
    public async Task<string?> GetOrFetchWorkflowNameAsync(
        string owner, string repo, long workflowId,
        GithubClient github, CancellationToken ct)
    {
        if (workflowId == 0)
            return null;

        var key = $"{owner}/{repo}:{workflowId}";
        if (_workflowNames.TryGet(key, out var cached))
            return cached;

        var name = await FetchWorkflowNameAsync(owner, repo, workflowId, github, ct);
        _workflowNames.Set(key, name);
        return name;
    }

    /// <summary>
    /// Returns the cached artifact content, or fetches it.
    /// Returns null when not found or on any error — never throws.
    /// Null results are cached to avoid redundant fetches.
    /// </summary>
    public async Task<string?> GetOrFetchArtifactAsync(
        string owner, string repo, long runId, string artifactName,
        GithubClient github, CancellationToken ct)
    {
        var key = $"{owner}/{repo}:{runId}:{artifactName}";
        if (_artifacts.TryGet(key, out var cached))
            return cached;

        var content = await FetchArtifactAsync(owner, repo, runId, artifactName, github, ct);
        _artifacts.Set(key, content);
        return content;
    }

    // ── private fetch helpers ─────────────────────────────────────────────────

    private static async Task<GhWorkflowRun?> FetchRunAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        try
        {
            return await github.GetAsync<GhWorkflowRun>(
                $"/repos/{owner}/{repo}/actions/runs/{runId}", ct);
        }
        catch
        {
            return null;
        }
    }

    private static async Task<string?> FetchWorkflowNameAsync(
        string owner, string repo, long workflowId,
        GithubClient github, CancellationToken ct)
    {
        try
        {
            var workflow = await github.GetAsync<GhWorkflow>(
                $"/repos/{owner}/{repo}/actions/workflows/{workflowId}", ct);
            return workflow?.Name;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Fetches the workflow graph for a run (§5.6.2).
    ///
    /// Step 1: GET /actions/runs/{runId} — obtain path, workflow_id, head_sha, name.
    ///   Returns null when the run is not found (non-2xx on the runs endpoint).
    ///
    /// Step 2 (identity): GET /actions/workflows/{workflow_id} — stable name (Actions:read only).
    ///   On failure (non-2xx, workflowId == 0): fall back to run.Name, then repo short name.
    ///
    /// Step 3 (needs-graph, best-effort): GET /contents/{path}?ref={sha} for YAML parent derivation.
    ///   On any non-2xx or parse error: return an empty-subgraph WorkflowGraph with the
    ///   already-resolved identity — parent_deployments = [] without blocking ingest (F10 / §5.5).
    /// </summary>
    private async Task<WorkflowGraph?> FetchGraphAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        // Step 1: run metadata — provides workflow_id, path, head_sha.
        GhWorkflowRun? run;
        try
        {
            run = await github.GetAsync<GhWorkflowRun>(
                $"/repos/{owner}/{repo}/actions/runs/{runId}", ct);
        }
        catch
        {
            return null;
        }

        if (run is null)
            return null;

        // Step 2: stable service identity via the workflow definition (Actions:read only).
        // Fallback chain: workflow endpoint name → run.Name → repo short name.
        var workflowName = await GetOrFetchWorkflowNameAsync(owner, repo, run.WorkflowId, github, ct);
        var identity = workflowName ?? run.Name ?? repo.Split('/').Last();

        // Step 3: YAML fetch is best-effort for the needs-graph (parent_deployments) only.
        // Identity is already resolved above — a contents failure cannot break it.
        try
        {
            var file = await github.GetAsync<GhWorkflowFileContent>(
                $"/repos/{owner}/{repo}/contents/{run.Path}?ref={run.HeadSha}", ct);

            if (file is not null)
            {
                var yaml = Encoding.UTF8.GetString(file.DecodeUtf8());

                // Parse the YAML to obtain the jobs graph (allJobs, deploymentJobs).
                // Override WorkflowName with `identity` (from the workflows endpoint) so
                // that service identity is stable regardless of what the YAML name: field says
                // and does not require Contents permission (F12 / §5.6.2).
                var parsed = WorkflowGraphParser.Parse(identity, yaml);
                return parsed with { WorkflowName = identity };
            }
        }
        catch
        {
            // Best-effort: contents fetch failed (e.g. 403 — Contents permission not granted).
            // Return empty subgraph with stable identity — parent_deployments = [] without
            // blocking ingest (F10 / §5.5).
        }

        return WorkflowGraph.Empty(identity);
    }

    private static async Task<string?> FetchArtifactAsync(
        string owner, string repo, long runId, string artifactName,
        GithubClient github, CancellationToken ct)
    {
        try
        {
            var list = await github.GetAsync<GhArtifactListResponse>(
                $"/repos/{owner}/{repo}/actions/runs/{runId}/artifacts", ct);
            if (list is null) return null;

            var artifact = list.Artifacts.FirstOrDefault(a => a.Name == artifactName && !a.Expired);
            if (artifact is null) return null;

            var bytes = await github.DownloadBytesAsync(
                $"/repos/{owner}/{repo}/actions/artifacts/{artifact.Id}/zip", ct);
            if (bytes is null) return null;

            using var zipStream = new MemoryStream(bytes);
            using var archive = new ZipArchive(zipStream, ZipArchiveMode.Read);
            var entry = archive.Entries.FirstOrDefault();
            if (entry is null) return null;

            using var reader = new StreamReader(entry.Open());
            return reader.ReadToEnd().Trim();
        }
        catch
        {
            return null;
        }
    }
}
