using System;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Thin admin-API client for the <c>mock-gha</c> JVM WireMock service.
/// Targets the JVM WireMock 3.x admin surface — see
/// <a href="https://wiremock.org/docs/">wiremock.org/docs</a>.
///
/// <para>Per CR-0012 § Profile-gating contract: the admin port is only
/// host-published under the integration compose profile. NFR-04 is
/// preserved by the gate, not by admin-API authentication; the WireMock
/// admin surface is unauthenticated by design.</para>
///
/// <para><b>Admin endpoints used.</b></para>
/// <list type="bullet">
///   <item><c>GET    /__admin/</c>                    — reachability probe on first use.</item>
///   <item><c>GET    /__admin/mappings</c>            — canonical admin-surface confirmation probe.</item>
///   <item><c>POST   /__admin/mappings/import</c>     — bulk-load a JSON array of mapping objects.</item>
///   <item><c>POST   /__admin/mappings/reset</c>      — clear all mappings; restore defaults.</item>
///   <item><c>GET    /__admin/requests</c>            — recorded requests against the mock surface.</item>
///   <item><c>DELETE /__admin/requests</c>            — clear the recorded request log.</item>
/// </list>
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

    public MockGhaClient()
        : this(TestEnvironment.CreateMockGhaAdminClient(), ownsHttp: true) { }

    public MockGhaClient(HttpClient http, bool ownsHttp = false)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _ownsHttp = ownsHttp;
    }

    /// <summary>
    /// One-shot reachability probe. Issues <c>GET /__admin/</c> then
    /// <c>GET /__admin/mappings</c> to verify the admin surface is up.
    /// Safe to call multiple times — the second call is a no-op.
    /// </summary>
    public async Task DiscoverAdminSurfaceAsync(CancellationToken ct = default)
    {
        if (_surfaceDiscovered) return;

        using var resp = await _http.GetAsync("/__admin/", ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha admin probe at {_http.BaseAddress}__admin/ returned {(int)resp.StatusCode}. " +
                $"Verify the integration compose profile is up. Body: {Truncate(body, 256)}");
        }

        // Confirm the admin surface root via a no-side-effect GET.
        using var mappingsList = await _http.GetAsync("/__admin/mappings", ct);
        if (!mappingsList.IsSuccessStatusCode)
        {
            var body = await mappingsList.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha admin probe at GET /__admin/mappings returned {(int)mappingsList.StatusCode}. " +
                $"Body: {Truncate(body, 256)}");
        }

        _surfaceDiscovered = true;
    }

    /// <summary>
    /// Load a scenario by name. Reads every <c>*.json</c> file under
    /// <c>testing/fixtures/gha/scenarios/{scenarioName}/</c> (resolved via
    /// <see cref="ScenarioBundleLoader"/>) and bulk-imports them via
    /// <c>POST /__admin/mappings/import</c> (JVM WireMock 3.x).
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

        var arrayBody = "[" + string.Join(",", mappings) + "]";
        using var content = new StringContent(arrayBody, Encoding.UTF8, "application/json");
        using var resp = await _http.PostAsync("/__admin/mappings/import", content, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var body = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha POST /__admin/mappings/import for scenario '{scenarioName}' returned " +
                $"{(int)resp.StatusCode}. Body: {Truncate(body, 512)}");
        }
    }

    /// <summary>
    /// Reset all mappings on the mock-gha instance via
    /// <c>POST /__admin/mappings/reset</c> (JVM WireMock 3.x).
    /// The end state is "no mappings active".
    /// </summary>
    public async Task ResetMappingsAsync(CancellationToken ct = default)
    {
        await DiscoverAdminSurfaceAsync(ct);

        using var resetReq = new HttpRequestMessage(HttpMethod.Post, "/__admin/mappings/reset");
        using var resetResp = await _http.SendAsync(resetReq, ct);
        if (!resetResp.IsSuccessStatusCode)
        {
            var body = await resetResp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"mock-gha POST /__admin/mappings/reset returned {(int)resetResp.StatusCode}. " +
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
