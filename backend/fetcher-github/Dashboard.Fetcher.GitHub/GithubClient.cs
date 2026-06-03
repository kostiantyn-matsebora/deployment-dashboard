using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Dashboard.Fetcher.GitHub.RateLimit;

namespace Dashboard.Fetcher.GitHub;

/// <summary>Result of a conditional paginated GET (F8).</summary>
/// <param name="NotModified">True when the server returned 304 — list is unchanged.</param>
/// <param name="Items">Items from the response; empty when <see cref="NotModified"/> is true.</param>
/// <param name="ETag">ETag from the 200 response, or <paramref name="ifNoneMatch"/> on 304, or null when absent.</param>
public readonly record struct ConditionalList<T>(bool NotModified, IReadOnlyList<T> Items, string? ETag);

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
            var response = await http.GetAsync(PagedUrl(path, page), ct);
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

    /// <summary>
    /// Conditional paginated GET (F8 / §5.4).
    /// Sends <c>If-None-Match</c> on page 1 only when <paramref name="ifNoneMatch"/> is non-null.
    /// A page-1 304 means the whole list is unchanged (GitHub returns items newest-first,
    /// so any new item changes page 1). Pages 2+ are fetched unconditionally.
    /// Returns <see cref="ConditionalList{T}.NotModified"/> = true on 304.
    /// On 404 returns an empty list with no ETag (mirrors <see cref="GetPagedAsync{T}"/> semantics).
    /// Graceful degradation: if the server omits ETag on 200, callers simply won't cache.
    /// </summary>
    public async Task<ConditionalList<T>> GetPagedConditionalAsync<T>(
        string path, string? ifNoneMatch, CancellationToken ct)
    {
        // ── Page 1: conditional request ──────────────────────────────────────
        var req = new HttpRequestMessage(HttpMethod.Get, PagedUrl(path, page: 1));
        if (ifNoneMatch is not null && EntityTagHeaderValue.TryParse(ifNoneMatch, out var etv))
            req.Headers.IfNoneMatch.Add(etv);

        var response = await http.SendAsync(req, ct);
        await rateLimitBudget.RecordAndWaitIfNeededAsync(response, ct);

        if (response.StatusCode == HttpStatusCode.NotModified)
            return new(NotModified: true, Items: [], ETag: ifNoneMatch);

        if (response.StatusCode == HttpStatusCode.NotFound)
            return new(NotModified: false, Items: [], ETag: null);

        response.EnsureSuccessStatusCode();

        var newEtag = response.Headers.ETag?.ToString();
        var page1Items = await response.Content.ReadFromJsonAsync<List<T>>(ct) ?? [];

        if (page1Items.Count == 0 || !HasNextPage(response))
            return new(NotModified: false, Items: page1Items, ETag: newEtag);

        // ── Pages 2+: unconditional ──────────────────────────────────────────
        var all = new List<T>(page1Items);
        var page = 2;
        while (!ct.IsCancellationRequested)
        {
            var pageResponse = await http.GetAsync(PagedUrl(path, page), ct);
            await rateLimitBudget.RecordAndWaitIfNeededAsync(pageResponse, ct);

            if (pageResponse.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NotModified)
                break;

            pageResponse.EnsureSuccessStatusCode();

            var pageItems = await pageResponse.Content.ReadFromJsonAsync<List<T>>(ct);
            if (pageItems is null || pageItems.Count == 0)
                break;

            all.AddRange(pageItems);

            if (!HasNextPage(pageResponse))
                break;

            page++;
        }

        return new(NotModified: false, Items: all, ETag: newEtag);
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

    private static string PagedUrl(string path, int page)
    {
        var sep = path.Contains('?') ? '&' : '?';
        return $"{path}{sep}per_page=100&page={page}";
    }

    private static bool HasNextPage(HttpResponseMessage response)
    {
        if (!response.Headers.TryGetValues("Link", out var values))
            return false;
        return string.Join(", ", values).Contains("rel=\"next\"");
    }
}
