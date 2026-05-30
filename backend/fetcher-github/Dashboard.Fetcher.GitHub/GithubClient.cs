using System.Net;
using System.Net.Http.Json;
using Dashboard.Fetcher.GitHub.RateLimit;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// Thin wrapper around the GitHub REST API HTTP client.
/// Handles pagination, rate-limit recording, and common status codes (F8, F16).
/// Authentication headers are set by the typed-client factory in DI.
/// </summary>
public sealed class GithubClient(HttpClient http, RateLimitBudget rateLimitBudget)
{
    /// <summary>GET a single resource. Returns null on 404 or 304.</summary>
    public async Task<T?> GetAsync<T>(string path, CancellationToken ct) where T : class
    {
        var response = await http.GetAsync(path, ct);
        await rateLimitBudget.RecordAndWaitIfNeededAsync(response, ct);

        if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NotModified)
            return null;

        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(ct);
    }

    /// <summary>
    /// Paginated GET — yields items across pages (per_page=100).
    /// Stops on 404, 304, empty page, or when the caller breaks.
    /// </summary>
    public async IAsyncEnumerable<T> GetPagedAsync<T>(string path,
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken ct)
    {
        var page = 1;
        while (!ct.IsCancellationRequested)
        {
            var sep = path.Contains('?') ? '&' : '?';
            var url = $"{path}{sep}per_page=100&page={page}";

            var response = await http.GetAsync(url, ct);
            await rateLimitBudget.RecordAndWaitIfNeededAsync(response, ct);

            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NotModified)
                yield break;

            response.EnsureSuccessStatusCode();

            var items = await response.Content.ReadFromJsonAsync<List<T>>(ct);
            if (items is null || items.Count == 0)
                yield break;

            foreach (var item in items)
                yield return item;

            if (!HasNextPage(response))
                yield break;

            page++;
        }
    }

    /// <summary>Downloads raw bytes (e.g. ZIP archive). Returns null on any non-2xx.</summary>
    public async Task<byte[]?> DownloadBytesAsync(string path, CancellationToken ct)
    {
        var response = await http.GetAsync(path, ct);
        await rateLimitBudget.RecordAndWaitIfNeededAsync(response, ct);

        if (!response.IsSuccessStatusCode)
            return null;

        return await response.Content.ReadAsByteArrayAsync(ct);
    }

    private static bool HasNextPage(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Link", out var values))
            return false;
        return string.Join(", ", values).Contains("rel=\"next\"");
    }
}
