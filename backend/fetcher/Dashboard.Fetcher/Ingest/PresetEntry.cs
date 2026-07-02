using System.Text.Json;

namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// One preset parsed from a source's <c>.deployment-dashboard/*.json</c> file
/// (issue #391 / FETCHER_SPECIFICATION §5.6.2). Tool-agnostic — carries only the fields
/// <see cref="IPresetIngestClient"/> needs to build the <c>PUT /api/presets/sources/{source}</c>
/// bundle. <see cref="Settings"/> is opaque and forwarded verbatim.
/// </summary>
public sealed record PresetEntry(string Name, JsonElement Settings);
