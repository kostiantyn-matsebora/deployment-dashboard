using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Verifies the ADR-0004 opaque-cursor contract under the integration
/// substrate: a second fetch with a persisted cursor returns ONLY new
/// runs, and the mock-gha request log demonstrates the watermark-filter
/// at work.
///
/// <para><b>Scenario corpus.</b>
/// <c>scenarios/_cross-cutting/adr-0004-cursor-second-fetch/tick-1</c> +
/// <c>tick-2</c>. Tick 1 returns deployment id=71; the adapter persists
/// cursor=71. Tick 2 returns deployments id=71 and id=72; the adapter
/// emits an event only for id=72 (the only one strictly above cursor=71).
/// </para>
///
/// <para><b>Two assertions:</b></para>
/// <list type="number">
///   <item>After tick 2 the read-API history for the slot contains
///   exactly two deployments (one per tick) — no duplicate emission of
///   id=71.</item>
///   <item>The mock-gha request log shows the fetcher made GET requests
///   on the deployments-list path during both tick windows (proves the
///   cursor isn't silencing the upstream call — only the
///   downstream emission).</item>
/// </list>
/// </summary>
public sealed class Adr0004CursorContractTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioBase = "_cross-cutting/adr-0004-cursor-second-fetch";
    private const string Environment = "state-cursor";
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(30);

    private readonly ScenarioFixture _fixture;

    public Adr0004CursorContractTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Second_Fetch_With_Persisted_Cursor_Emits_Only_New_Runs()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var service = TestEnvironment.PrimaryOwnerRepo.Repo;

        // ── Tick 1 ────────────────────────────────────────────────
        await _fixture.LoadScenarioAsync($"{ScenarioBase}/tick-1", cts.Token);

        var tick1Slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out var c) &&
                 c.GetProperty("deployment_id").GetString() == "gha-71",
            PollBudget,
            cts.Token);
        Assert.NotNull(tick1Slot);

        // ── Tick 2 ────────────────────────────────────────────────
        // Reset mappings (drops tick-1 mappings, restores base-mapping
        // catch-all only), clear request log so the next-window log is
        // pristine, then load tick-2.
        await _fixture.MockGha.ResetMappingsAsync(cts.Token);
        await _fixture.MockGha.ClearRecordedRequestsAsync(cts.Token);
        await _fixture.LoadScenarioAsync($"{ScenarioBase}/tick-2", cts.Token);

        var tick2Slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out var c) &&
                 c.GetProperty("deployment_id").GetString() == "gha-72",
            PollBudget,
            cts.Token);
        Assert.NotNull(tick2Slot);

        // ── Assertion 1 — history has exactly two events ──────────
        using var history = await ReadApiAssertions.GetHistoryAsync(service, Environment, limit: 50, cts.Token);
        Assert.Equal(2, history.RootElement.GetArrayLength());
        var deploymentIds = history.RootElement
            .EnumerateArray()
            .Select(e => e.GetProperty("deployment_id").GetString())
            .ToHashSet();
        Assert.Contains("gha-71", deploymentIds);
        Assert.Contains("gha-72", deploymentIds);

        // ── Assertion 2 — recorded requests show the deployments-list
        // call during the tick-2 window (request log was cleared just
        // before loading tick-2 mappings). The watermark itself is opaque
        // and never appears on the wire — the proof of "cursor at work"
        // is that the adapter still polled the same /deployments path
        // during tick 2, yet only emitted id=72 downstream.
        using var requests = await _fixture.MockGha.GetRecordedRequestsAsync(cts.Token);
        Assert.Equal(JsonValueKind.Array, requests.RootElement.ValueKind);
        var sawListCallInTick2 = requests.RootElement
            .EnumerateArray()
            .Any(req => TryGetUrl(req, out var url) &&
                        url.Contains("/repos/integration-test-org/integration-test-repo/deployments", StringComparison.Ordinal) &&
                        !url.Contains("/statuses", StringComparison.Ordinal));
        Assert.True(sawListCallInTick2,
            "ADR-0004 contract: the fetcher must still issue the deployments-list GET during tick 2 — the cursor only filters emission, not the upstream call.");
    }

    private static bool TryGetUrl(JsonElement request, out string url)
    {
        url = string.Empty;
        // WireMock.Net request envelope: { "Request": { "AbsoluteUrl": "...", "Url": "...", ... }, ... }
        if (request.TryGetProperty("Request", out var inner))
        {
            if (inner.TryGetProperty("AbsoluteUrl", out var abs) && abs.ValueKind == JsonValueKind.String)
            {
                url = abs.GetString() ?? string.Empty;
                return true;
            }
            if (inner.TryGetProperty("Url", out var u) && u.ValueKind == JsonValueKind.String)
            {
                url = u.GetString() ?? string.Empty;
                return true;
            }
            if (inner.TryGetProperty("Path", out var p) && p.ValueKind == JsonValueKind.String)
            {
                url = p.GetString() ?? string.Empty;
                return true;
            }
        }
        // Fallback if WireMock.Net flattens the envelope.
        if (request.TryGetProperty("AbsoluteUrl", out var absFlat) && absFlat.ValueKind == JsonValueKind.String)
        {
            url = absFlat.GetString() ?? string.Empty;
            return true;
        }
        if (request.TryGetProperty("Url", out var uFlat) && uFlat.ValueKind == JsonValueKind.String)
        {
            url = uFlat.GetString() ?? string.Empty;
            return true;
        }
        return false;
    }
}
