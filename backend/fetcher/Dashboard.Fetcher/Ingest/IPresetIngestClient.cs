namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// Publishes the authoritative preset bundle for one source (issue #391 — preset discovery).
/// Contract: docs/api/openapi.yaml <c>presets</c> tag (<c>PUT /api/presets/sources/{source}</c>),
/// docs/API_SPECIFICATION.md <c>provided_presets</c>, FETCHER_SPECIFICATION.md
/// "Preset discovery".
/// </summary>
public interface IPresetIngestClient
{
    /// <summary>
    /// Replaces the entire preset set owned by <paramref name="source"/> (a GitHub
    /// <c>owner/repo</c>) via <c>PUT /api/presets/sources/{source}</c>. An empty
    /// <paramref name="presets"/> list is a valid authoritative-empty (prune-all) bundle —
    /// callers decide when pruning is safe (never on a failed/absent directory read).
    /// </summary>
    Task PutAsync(string source, IReadOnlyList<PresetEntry> presets, CancellationToken ct);
}
