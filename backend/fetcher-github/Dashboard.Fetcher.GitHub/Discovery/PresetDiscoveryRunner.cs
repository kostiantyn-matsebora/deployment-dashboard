using System.Text;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.Discovery;

/// <summary>
/// Slow-cadence GitHub preset-discovery step (issue #391). Contract: docs/api/openapi.yaml
/// <c>presets</c> tag (<c>PUT /api/presets/sources/{source}</c>), docs/API_SPECIFICATION.md
/// <c>provided_presets</c>, and FETCHER_SPECIFICATION.md "Preset discovery" — SEPARATE from
/// the deployment poll loop (own cadence via <see cref="Orchestration.DiscoveryLoop"/>).
///
/// Per configured <c>owner/repo</c> (<see cref="GithubAdapterOptions.RepoList"/>):
/// <list type="number">
///   <item>List <c>GET /repos/{o}/{r}/contents/.deployment-dashboard</c>, ETag-conditional.</item>
///   <item>For every <c>*.json</c> file entry, fetch and Base64-decode its content.</item>
///   <item>Parse each file SINGLE-OR-BUNDLE (<see cref="PresetFileParser"/>) and aggregate.</item>
///   <item>PUT the aggregated bundle via <see cref="IPresetIngestClient"/>.</item>
/// </list>
///
/// Semantics (keep-last-known-good):
/// <list type="bullet">
///   <item>Directory listing 304 → reuse; no re-PUT.</item>
///   <item>Directory listing 200 (including an empty directory) → replace — PUT the full
///     aggregated set, or an empty <c>presets: []</c> bundle to prune.</item>
///   <item>Directory listing 403 / 404 / any other non-2xx, OR a per-file fetch/parse error
///     for ANY file in the directory → SKIP the entire source. Never prune, never publish a
///     partial bundle — the source keeps whatever it last successfully published.</item>
/// </list>
/// </summary>
public sealed class PresetDiscoveryRunner(
    GithubClient github,
    IPresetIngestClient ingestClient,
    GithubAdapterOptions options,
    ILogger<PresetDiscoveryRunner> logger)
{
    private const string DiscoveryDirectory = ".deployment-dashboard";

    // owner/repo → last-seen directory-listing ETag. Only advanced after a successful
    // (200 → parsed → PUT'd) cycle, so a failed cycle retries the same directory state
    // next time rather than silently adopting a partial/failed read as "known".
    private readonly Dictionary<string, string?> _etagBySource = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Runs one discovery cycle across every configured repo. Never throws —
    /// per-source failures are caught and logged so one bad source cannot block the rest.</summary>
    public async Task RunOnceAsync(CancellationToken ct)
    {
        foreach (var source in options.RepoList)
        {
            try
            {
                await DiscoverSourceAsync(source, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "[Discovery] {Source}: cycle failed; skipping (no prune)", source);
            }
        }
    }

    private async Task DiscoverSourceAsync(string source, CancellationToken ct)
    {
        var ifNoneMatch = _etagBySource.GetValueOrDefault(source);

        var listing = await github.GetDirectoryConditionalAsync<GhContentEntry>(
            $"/repos/{source}/contents/{DiscoveryDirectory}", ifNoneMatch, ct);

        if (listing.NotModified)
        {
            logger.LogDebug("[Discovery] {Source}: directory listing 304 — reusing, no re-PUT", source);
            return;
        }

        if (listing.NotFound)
        {
            logger.LogDebug(
                "[Discovery] {Source}: {Dir} not found (404) — skipping, no prune",
                source, DiscoveryDirectory);
            return;
        }

        // 200 — authoritative read. Even zero json entries is a valid, publishable
        // (prune-all) result, UNLIKE a 403/404/error which must never reach the PUT below.
        var jsonEntries = listing.Items
            .Where(e => string.Equals(e.Type, "file", StringComparison.OrdinalIgnoreCase)
                        && e.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var presets = new List<PresetEntry>();
        foreach (var entry in jsonEntries)
        {
            var parsed = await FetchAndParseAsync(source, entry, ct);
            if (parsed is null)
            {
                // Any single file's fetch/parse failure aborts the WHOLE source — never a
                // partial publish, never a prune (FETCHER_SPECIFICATION.md "Preset discovery"
                // keep-last-known-good).
                logger.LogWarning(
                    "[Discovery] {Source}: file {File} fetch/parse failed — skipping source, no prune",
                    source, entry.Path);
                return;
            }
            presets.AddRange(parsed);
        }

        await ingestClient.PutAsync(source, presets, ct);
        _etagBySource[source] = listing.ETag;
        logger.LogInformation(
            "[Discovery] {Source}: published {Count} preset(s) from {FileCount} file(s)",
            source, presets.Count, jsonEntries.Count);
    }

    /// <summary>Fetches one content entry and parses it SINGLE-OR-BUNDLE. Returns null on any
    /// non-2xx fetch or a parse error — never throws (caller aborts the whole source on null).</summary>
    private async Task<IReadOnlyList<PresetEntry>?> FetchAndParseAsync(
        string source, GhContentEntry entry, CancellationToken ct)
    {
        try
        {
            var file = await github.GetAsync<GhWorkflowFileContent>(
                $"/repos/{source}/contents/{entry.Path}", ct);
            if (file is null)
                return null;

            var json = Encoding.UTF8.GetString(file.DecodeUtf8());

            return PresetFileParser.Parse(json);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }
}
