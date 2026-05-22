using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Thin admin-API client for the <c>mock-gha</c> WireMock.Net service.
/// Resolves the admin route surface dynamically because WireMock.Net's
/// admin paths differ subtly from upstream Java WireMock's — most notably
/// no <c>POST /__admin/mappings/import</c> and no
/// <c>POST /__admin/mappings/reset</c>; both are replaced by
/// <c>POST /__admin/mappings</c> (accepting either a single object or an
/// array body) and <c>DELETE /__admin/mappings</c> respectively.
///
/// <para>Per CR-0012 § Profile-gating contract: the admin port is only
/// host-published under the integration compose profile. NFR-04 is
/// preserved by the gate, not by admin-API authentication; the WireMock
/// admin surface is unauthenticated by design.</para>
///
/// <para><b>Admin endpoint discovery.</b> On construction we issue
/// <c>GET /__admin/</c> once to verify reachability and to capture the
/// response body for diagnostic logging. The exact route inventory of
/// WireMock.Net is documented at
/// <a href="https://github.com/WireMock-Net/WireMock.Net/wiki/Admin-API-Reference">
/// Admin API Reference</a>; the canonical paths we depend on are:</para>
/// <list type="bullet">
///   <item><c>POST   /__admin/mappings</c>            — add mapping(s); body is one mapping object OR an array of mapping objects.</item>
///   <item><c>DELETE /__admin/mappings</c>            — reset all mappings (functional equivalent of upstream Java WireMock's <c>POST /__admin/mappings/reset</c>).</item>
///   <item><c>POST   /__admin/mappings/reset</c>      — present in some WireMock.Net builds; tried first when resetting and fallen back from on 404.</item>
///   <item><c>POST   /__admin/mappings/import</c>     — present in some WireMock.Net builds; tried first on bulk load and fallen back to per-mapping POSTs on 404.</item>
///   <item><c>GET    /__admin/requests</c>            — recorded requests against the mock surface.</item>
///   <item><c>DELETE /__admin/requests</c>            — clear the recorded request log.</item>
/// </list>
///
/// <para><b>Robustness.</b> Every call that depends on a path that may not
/// exist falls back gracefully (per-mapping <c>POST</c> instead of bulk
/// import; <c>DELETE /__admin/mappings</c> instead of <c>/reset</c>). The
/// chosen path is logged once on first use so test output is
/// self-explanatory if a future WireMock.Net upgrade reshuffles the
/// surface.</para>
///
/// <para>All methods are idempotent within a single scenario; the per-test
/// fixture (<see cref="ScenarioFixture"/>) drives reset + load + later
/// inspection.</para>
/// </summary>
public sealed class MockGhaClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly bool _ownsHttp;
    private bool _surfaceDiscovered;
    private bool _supportsBulkImport;
    private bool _supportsMappingsReset;

    public MockGhaClient()
        : this(TestEnvironment.CreateMockGhaAdminClient(), ownsHttp: true) { }

    public MockGhaClient(HttpClient http, bool ownsHttp = false)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _ownsHttp = ownsHttp;
    }

    /// <summary>
    /// One-shot reachability + surface discovery probe. Issues
    /// <c>GET /__admin/</c> and (best-effort) inspects the response to
    /// pre-decide which bulk-load + reset paths are supported. Safe to
    /// call multiple times — the second call is a no-op.
    /// </summary>
    public async Task DiscoverAdminSurfaceAsync(CancellationToken ct = default)
    {
        if (_surfaceDiscovered) return;

        using var resp = await _http.GetAsync("/__admin/", ct);
        if (resp.StatusCode != HttpStatusCode.OK && resp.StatusCode != HttpStatusCode.NotFound)
        {
            // Many WireMock.Net builds return 200 at "/__admin/" with a
            // landing-page body; some return 404. Both are acceptable; any
            // other status is a sign mock-gha is not actually a WireMock
            // server.
            var body = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha admin probe at {_http.BaseAddress}__admin/ returned {(int)resp.StatusCode}. " +
                $"Verify the integration compose profile is up. Body: {Truncate(body, 256)}");
        }

        // Probe (HEAD/OPTIONS aren't reliably supported by WireMock.Net for
        // admin paths) by issuing a no-side-effect GET /__admin/mappings.
        // That route is canonical and confirms the admin surface root.
        using var mappingsList = await _http.GetAsync("/__admin/mappings", ct);
        if (!mappingsList.IsSuccessStatusCode)
        {
            var body = await mappingsList.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha admin probe at GET /__admin/mappings returned {(int)mappingsList.StatusCode}. " +
                $"Body: {Truncate(body, 256)}");
        }

        // We can't cheaply probe the import + reset endpoints without
        // mutating state, so we treat both as "try first; fall back on
        // 404/405". Mark the surface as discovered.
        _supportsBulkImport = true;
        _supportsMappingsReset = true;
        _surfaceDiscovered = true;
    }

    /// <summary>
    /// Load a scenario by name. Reads every <c>*.json</c> file under
    /// <c>testing/fixtures/gha/scenarios/{scenarioName}/</c> (resolved via
    /// <see cref="ScenarioBundleLoader"/>), and posts each mapping into
    /// the running WireMock instance. Prefers the bulk import endpoint;
    /// falls back to per-mapping <c>POST /__admin/mappings</c> if bulk
    /// import is unsupported.
    /// </summary>
    public async Task LoadScenarioAsync(string scenarioName, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(scenarioName))
        {
            throw new ArgumentException("Scenario name must be non-empty.", nameof(scenarioName));
        }
        await DiscoverAdminSurfaceAsync(ct);

        var mappings = ScenarioBundleLoader.LoadScenarioMappings(scenarioName);
        if (mappings.Count == 0)
        {
            throw new InvalidOperationException(
                $"Scenario '{scenarioName}' resolved to zero mapping files. " +
                $"Expected at least one *.json file under {ScenarioBundleLoader.ResolveScenarioDirectory(scenarioName)}.");
        }

        if (_supportsBulkImport)
        {
            var arrayBody = "[" + string.Join(",", mappings) + "]";
            using var content = new StringContent(arrayBody, Encoding.UTF8, "application/json");
            using var resp = await _http.PostAsync("/__admin/mappings/import", content, ct);
            if (resp.StatusCode == HttpStatusCode.NotFound || resp.StatusCode == HttpStatusCode.MethodNotAllowed)
            {
                _supportsBulkImport = false; // future calls skip the import path
            }
            else if (!resp.IsSuccessStatusCode)
            {
                var body = await resp.Content.ReadAsStringAsync(ct);
                throw new InvalidOperationException(
                    $"mock-gha POST /__admin/mappings/import for scenario '{scenarioName}' returned " +
                    $"{(int)resp.StatusCode}. Body: {Truncate(body, 512)}");
            }
            else
            {
                return;
            }
        }

        // Fallback: one mapping at a time. WireMock.Net's POST /__admin/mappings
        // accepts either a single mapping body or an array; we send an array
        // to keep the wire shape uniform.
        var fallbackBody = "[" + string.Join(",", mappings) + "]";
        using var fallback = new StringContent(fallbackBody, Encoding.UTF8, "application/json");
        using var fallbackResp = await _http.PostAsync("/__admin/mappings", fallback, ct);
        if (!fallbackResp.IsSuccessStatusCode)
        {
            var body = await fallbackResp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha POST /__admin/mappings for scenario '{scenarioName}' returned " +
                $"{(int)fallbackResp.StatusCode}. Body: {Truncate(body, 512)}");
        }
    }

    /// <summary>
    /// Reset all mappings on the mock-gha instance. Tries
    /// <c>POST /__admin/mappings/reset</c> first (mirrors upstream Java
    /// WireMock's API; some WireMock.Net builds support it); falls back to
    /// <c>DELETE /__admin/mappings</c> (the canonical WireMock.Net path)
    /// on 404 / 405. The end state is "no mappings active".
    /// </summary>
    public async Task ResetMappingsAsync(CancellationToken ct = default)
    {
        await DiscoverAdminSurfaceAsync(ct);

        if (_supportsMappingsReset)
        {
            using var resetReq = new HttpRequestMessage(HttpMethod.Post, "/__admin/mappings/reset");
            using var resetResp = await _http.SendAsync(resetReq, ct);
            if (resetResp.StatusCode == HttpStatusCode.NotFound || resetResp.StatusCode == HttpStatusCode.MethodNotAllowed)
            {
                _supportsMappingsReset = false;
            }
            else if (!resetResp.IsSuccessStatusCode)
            {
                var body = await resetResp.Content.ReadAsStringAsync(ct);
                throw new InvalidOperationException(
                    $"mock-gha POST /__admin/mappings/reset returned {(int)resetResp.StatusCode}. " +
                    $"Body: {Truncate(body, 512)}");
            }
            else
            {
                return;
            }
        }

        using var delReq = new HttpRequestMessage(HttpMethod.Delete, "/__admin/mappings");
        using var delResp = await _http.SendAsync(delReq, ct);
        if (!delResp.IsSuccessStatusCode)
        {
            var body = await delResp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha DELETE /__admin/mappings returned {(int)delResp.StatusCode}. " +
                $"Body: {Truncate(body, 512)}");
        }
    }

    /// <summary>
    /// Inspect the recorded requests the fetcher made against the mock
    /// surface. Returns the raw JSON array body — callers can use
    /// <see cref="JsonDocument"/> to parse for negative assertions
    /// ("fetcher did NOT call workflow-contents during this scenario") or
    /// cursor-drift assertions ("second tick filters by watermark").
    /// </summary>
    public async Task<JsonDocument> GetRecordedRequestsAsync(CancellationToken ct = default)
    {
        await DiscoverAdminSurfaceAsync(ct);

        using var resp = await _http.GetAsync("/__admin/requests", ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha GET /__admin/requests returned {(int)resp.StatusCode}. Body: {Truncate(body, 512)}");
        }
        var stream = await resp.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
    }

    /// <summary>
    /// Clear the mock-gha request log. Called by <see cref="ScenarioFixture"/>
    /// between scenarios so negative assertions can be authored without
    /// worrying about cross-scenario residue.
    /// </summary>
    public async Task ClearRecordedRequestsAsync(CancellationToken ct = default)
    {
        await DiscoverAdminSurfaceAsync(ct);

        using var req = new HttpRequestMessage(HttpMethod.Delete, "/__admin/requests");
        using var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha DELETE /__admin/requests returned {(int)resp.StatusCode}. " +
                $"Body: {Truncate(body, 512)}");
        }
    }

    public void Dispose()
    {
        if (_ownsHttp)
        {
            _http.Dispose();
        }
    }

    private static string Truncate(string s, int max)
        => string.IsNullOrEmpty(s) || s.Length <= max ? (s ?? string.Empty) : s[..max] + "...";
}
