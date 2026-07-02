using System.Net.Http.Json;

namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// HTTP client for <c>PUT /api/presets/sources/{source}</c> (issue #391 / §5.6.2).
/// X-Api-Key is added by the typed-client factory in DI (mirrors <see cref="FetcherStateClient"/>).
/// The PUT payload is an anonymous object per-project convention — no shared DTO
/// (docs/api/openapi.yaml <c>PresetBundle</c> / <c>Preset</c> are the wire contract; this
/// project owns only its own request shape).
/// </summary>
public sealed class PresetIngestClient(HttpClient http) : IPresetIngestClient
{
    public async Task PutAsync(string source, IReadOnlyList<PresetEntry> presets, CancellationToken ct)
    {
        // `source` is `owner/repo` — the API matches it with a catch-all route and expects
        // the literal `/` in the path (docs/api/openapi.yaml). Escape each segment
        // individually so odd characters in owner/repo names are safe, but keep the
        // separating `/` unescaped so the catch-all still captures the full value.
        var path = string.Join('/', source.Split('/').Select(Uri.EscapeDataString));

        var response = await http.PutAsJsonAsync(
            $"/api/presets/sources/{path}",
            new
            {
                version = 1,
                presets = presets.Select(p => new { version = 1, name = p.Name, settings = p.Settings }),
            },
            ct);
        response.EnsureSuccessStatusCode();
    }
}
