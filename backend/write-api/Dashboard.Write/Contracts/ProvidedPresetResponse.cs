using System.Text.Json;
using Dashboard.Shared.Entities;

namespace Dashboard.Write.Contracts;

/// <summary>
/// Response item for <c>GET /api/presets</c> (OpenAPI <c>ProvidedPreset</c>). <see cref="Settings"/>
/// is re-emitted as a raw JSON object (not a quoted string) by reparsing the stored verbatim
/// <c>settings_json</c> blob.
/// </summary>
public sealed record ProvidedPresetResponse(
    string Source,
    string Name,
    int Version,
    JsonElement Settings,
    DateTimeOffset FetchedAt)
{
    internal static ProvidedPresetResponse FromEntity(ProvidedPreset e) =>
        new(e.Source, e.Name, e.Version, JsonDocument.Parse(e.SettingsJson).RootElement.Clone(), e.FetchedAt);
}

/// <summary>
/// Response body for <c>GET /api/presets</c> (OpenAPI <c>ProvidedPresets</c>) — the merged
/// provided-preset catalog across every source.
/// </summary>
public sealed record ProvidedPresetsResponse(IReadOnlyList<ProvidedPresetResponse> Items);
