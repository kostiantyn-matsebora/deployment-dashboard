using Dashboard.Shared.Entities;

namespace Dashboard.Write.Repositories;

internal interface IProvidedPresetRepository
{
    /// <summary>
    /// Replaces the entire set of presets owned by <paramref name="source"/> with
    /// <paramref name="presets"/> in one transaction (authoritative-replace, last write wins).
    /// An empty <paramref name="presets"/> prunes every preset previously published by the source.
    /// </summary>
    Task ReplaceForSourceAsync(string source, IReadOnlyList<ProvidedPreset> presets, CancellationToken ct);

    /// <summary>Returns every provided preset across every source, for the merged read catalog.</summary>
    Task<IReadOnlyList<ProvidedPreset>> GetAllAsync(CancellationToken ct);
}
