using System.Net;
using System.Net.Http.Json;

namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// HTTP client for GET/PUT /api/fetcher/state/{adapter}.
/// X-Api-Key is added by the typed-client factory in DI.
/// </summary>
public sealed class FetcherStateClient(HttpClient http) : IFetcherStateClient
{
    public async Task<string?> GetAsync(string adapterId, CancellationToken ct)
    {
        var response = await http.GetAsync($"/api/fetcher/state/{adapterId}", ct);

        if (response.StatusCode == HttpStatusCode.NotFound)
            return null;

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<StateResponse>(ct);
        return body?.Cursor;
    }

    public async Task PutAsync(string adapterId, string cursor, CancellationToken ct)
    {
        var response = await http.PutAsJsonAsync(
            $"/api/fetcher/state/{adapterId}",
            new { cursor },
            ct);
        response.EnsureSuccessStatusCode();
    }

    private sealed record StateResponse(string Cursor);
}
