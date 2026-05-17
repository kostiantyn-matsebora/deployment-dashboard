using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Phase 5 targeted regression for CR-0008 — Read API 4xx responses are
/// <c>application/problem+json</c> per CR-0008 Decision 6 ("apply
/// ProblemDetails to non-ingest endpoints' 4xx responses").
///
/// <list type="bullet">
///   <item>Case #8: bad <c>correlationAttribute</c> -> 400 problem+json
///         with <c>error</c> slug at top level.</item>
///   <item>Case #9: unknown slot history -> 404 problem+json with
///         <c>error</c> slug at top level.</item>
/// </list>
///
/// <para>TIGHT oracle: distinguishes the CR-0008 wire shape from the
/// pre-CR-0008 bodies (raw JSON or empty 404). The legacy <c>error</c>
/// slug being preserved as a top-level extension member is a
/// load-bearing detail — clients that switched on the old slug must
/// keep working.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class ReadErrorContractTests : IDisposable
{
    private readonly HttpClient _read;

    public ReadErrorContractTests()
    {
        _read = TestEnvironment.CreateReadClient();
    }

    public void Dispose() => _read.Dispose();

    // --------------------------------------------------------- Case #8

    [Fact]
    public async Task GetMatrix_InvalidCorrelationAttribute_Returns400_AsProblemJsonWithErrorSlug()
    {
        // 'zzz' is not in the allowed set (version, ref, sha, actor, run, ago).
        var resp = await _read.GetAsync("/api/deployments?correlationAttribute=zzz");

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("type", out _));
        Assert.True(root.TryGetProperty("title", out _));
        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 400);

        // Legacy slug preserved as a top-level extension member.
        Assert.True(root.TryGetProperty("error", out var errorSlug) && errorSlug.ValueKind == JsonValueKind.String,
            "400 ProblemDetails MUST preserve the legacy error slug at top level (extensions['error']).");
        Assert.False(string.IsNullOrWhiteSpace(errorSlug.GetString()));
    }

    // --------------------------------------------------------- Case #9

    [Fact]
    public async Task GetHistory_UnknownService_Returns404_AsProblemJsonWithErrorSlug()
    {
        // Service that demonstrably cannot exist in any seeded corpus.
        var nonexistent = $"nonexistent-svc-zzz-{Guid.NewGuid():N}";
        var resp = await _read.GetAsync($"/api/deployments/{nonexistent}/dev/history");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);

        // CR-0008 Decision 6 + verbatim row "Read API: not-found
        // resource (e.g. unknown service slot) -> 404 Not Found -> ProblemDetails".
        // An empty 404 body (Content-Length: 0) is a regression.
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        var raw = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(raw), "404 must carry a problem+json body, not an empty response.");

        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 404);
        Assert.True(root.TryGetProperty("error", out var errorSlug) && errorSlug.ValueKind == JsonValueKind.String,
            "404 ProblemDetails MUST preserve the legacy error slug at top level (extensions['error']).");
        Assert.False(string.IsNullOrWhiteSpace(errorSlug.GetString()));
    }

    [Fact]
    public async Task GetSlot_UnknownService_Returns404_AsProblemJson()
    {
        // Companion to the history 404 — the matrix slot endpoint also
        // returns 404 for an unknown (service, environment) per SAD §7,
        // and CR-0008 Decision 6 brings it under the problem+json
        // umbrella. Tightened in lockstep with the history-404 oracle
        // so both 404 paths share the same shape (Phase 6 defect fix:
        // both must carry the legacy `error` slug at top level).
        var nonexistent = $"nonexistent-svc-zzz-{Guid.NewGuid():N}";
        var resp = await _read.GetAsync($"/api/deployments/{nonexistent}/dev");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        var raw = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(raw), "404 must carry a problem+json body, not an empty response.");

        using var doc = JsonDocument.Parse(raw);
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 404);
        Assert.True(root.TryGetProperty("error", out var errorSlug) && errorSlug.ValueKind == JsonValueKind.String,
            "404 ProblemDetails MUST preserve the legacy error slug at top level (extensions['error']).");
        Assert.False(string.IsNullOrWhiteSpace(errorSlug.GetString()));
    }
}
