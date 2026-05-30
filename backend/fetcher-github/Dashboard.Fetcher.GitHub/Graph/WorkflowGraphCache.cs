using System.IO.Compression;
using System.Text;
using Dashboard.Fetcher.GitHub.Models;

namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>
/// LRU cache (≤ 200 entries) for workflow graphs and artifact content (F11).
/// Workflow runs and artifact archives are immutable — no cache invalidation needed.
/// </summary>
public sealed class WorkflowGraphCache
{
    private readonly BoundedLruCache<string, WorkflowGraph?> _graphs = new(200);
    private readonly BoundedLruCache<string, string?> _artifacts = new(200);

    /// <summary>
    /// Returns the cached graph, or fetches it via GitHub (§5.6.2).
    /// Returns null on non-2xx or YAML parse error — never throws.
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

    private static async Task<WorkflowGraph?> FetchGraphAsync(
        string owner, string repo, long runId,
        GithubClient github, CancellationToken ct)
    {
        try
        {
            var run = await github.GetAsync<GhWorkflowRun>(
                $"/repos/{owner}/{repo}/actions/runs/{runId}", ct);
            if (run is null) return null;

            var file = await github.GetAsync<GhWorkflowFileContent>(
                $"/repos/{owner}/{repo}/contents/{run.Path}?ref={run.HeadSha}", ct);
            if (file is null) return null;

            var yaml = Encoding.UTF8.GetString(
                Convert.FromBase64String(file.Content.Replace("\n", "")));

            return WorkflowGraphParser.Parse(run.Name ?? repo.Split('/').Last(), yaml);
        }
        catch
        {
            return null;
        }
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
