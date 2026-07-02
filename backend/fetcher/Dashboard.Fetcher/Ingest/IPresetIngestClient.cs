namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// Publishes the authoritative preset bundle for one source (issue #391 / §5.6.2).
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
