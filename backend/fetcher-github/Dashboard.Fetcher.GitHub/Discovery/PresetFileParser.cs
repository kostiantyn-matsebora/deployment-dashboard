using System.Text.Json;
using Dashboard.Fetcher.Ingest;

namespace Dashboard.Fetcher.GitHub.Discovery;

/// <summary>
/// Parses one <c>.deployment-dashboard/*.json</c> file as SINGLE-OR-BUNDLE
/// (issue #391 / §5.6.2): either a single preset envelope <c>{version,name,settings}</c>
/// or a bundle <c>{version,presets:[...]}</c> of the same envelopes.
///
/// Throws <see cref="FormatException"/> (or lets a <see cref="JsonException"/> propagate) on
/// malformed JSON or a shape matching neither form. Callers treat any exception as a
/// parse-error — per §5.6.2 discovery semantics that means the whole source is SKIPPED
/// (never partially applied, never pruned) — see <see cref="PresetDiscoveryRunner"/>.
/// </summary>
public static class PresetFileParser
{
    public static IReadOnlyList<PresetEntry> Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (root.ValueKind != JsonValueKind.Object)
            throw new FormatException("Preset file root must be a JSON object.");

        if (root.TryGetProperty("presets", out var presetsEl))
        {
            if (presetsEl.ValueKind != JsonValueKind.Array)
                throw new FormatException("`presets` must be an array.");

            var list = new List<PresetEntry>();
            foreach (var item in presetsEl.EnumerateArray())
                list.Add(ParseSingle(item));
            return list;
        }

        return [ParseSingle(root)];
    }

    private static PresetEntry ParseSingle(JsonElement el)
    {
        if (el.ValueKind != JsonValueKind.Object)
            throw new FormatException("Preset entry must be a JSON object.");

        if (!el.TryGetProperty("name", out var nameEl) || nameEl.ValueKind != JsonValueKind.String)
            throw new FormatException("Preset entry missing string `name`.");

        var name = nameEl.GetString()!;
        if (string.IsNullOrWhiteSpace(name))
            throw new FormatException("Preset `name` must be non-empty.");

        if (!el.TryGetProperty("settings", out var settingsEl) || settingsEl.ValueKind != JsonValueKind.Object)
            throw new FormatException("Preset entry missing object `settings`.");

        // Clone — settingsEl is backed by the JsonDocument, which the caller disposes
        // once Parse returns.
        return new PresetEntry(name, settingsEl.Clone());
    }
}
