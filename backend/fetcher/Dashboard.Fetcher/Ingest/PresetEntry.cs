using System.Text.Json;

namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// One preset parsed from a source's <c>.deployment-dashboard/*.json</c> file (issue #391 —
/// preset discovery; see FETCHER_SPECIFICATION.md "Preset discovery"). Tool-agnostic — carries
/// only the fields <see cref="IPresetIngestClient"/> needs to build the
/// <c>PUT /api/presets/sources/{source}</c> bundle (docs/api/openapi.yaml <c>presets</c> tag;
/// docs/API_SPECIFICATION.md <c>provided_presets</c>). <see cref="Settings"/> is opaque and
/// forwarded verbatim.
/// </summary>
public sealed record PresetEntry(string Name, JsonElement Settings);
