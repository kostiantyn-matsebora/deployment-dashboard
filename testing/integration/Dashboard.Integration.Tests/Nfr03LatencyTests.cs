using System;
using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Verifies NFR-03 — every fetcher-produced event surfaces on the Read
/// API + SSE within 5 s of its mock-gha appearance.
///
/// <para><b>Scenario corpus.</b>
/// <c>scenarios/_cross-cutting/nfr-03-latency/</c> — a single success
/// deployment id=81 on env=<c>state-latency</c>. The test stop-watches
/// scenario-load → first SSE frame, then re-asserts via
/// <c>GET /api/deployments</c> within the same budget.</para>
///
/// <para>This is more rigorous than the per-state NFR-03 spot check
/// because the budget excludes mock-gha admin latency (the timer starts
/// AFTER <c>LoadScenarioAsync</c> completes) but includes a full poll
/// cycle + DB persist + NOTIFY/LISTEN fan-out.</para>
/// </summary>
public sealed class Nfr03LatencyTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "_cross-cutting/nfr-03-latency";
    private const string Environment = "state-latency";
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(5);

    private readonly ScenarioFixture _fixture;

    public Nfr03LatencyTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task First_Sse_Frame_And_Matrix_Row_Within_5_Seconds_Of_Scenario_Load()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var service = TestEnvironment.PrimaryOwnerRepo.Repo;

        await using var sse = await SseListener.OpenAsync(cts.Token);

        var sw = Stopwatch.StartNew();
        await _fixture.LoadScenarioAsync(ScenarioName, cts.Token);

        // Restart the stopwatch AFTER scenario load so we measure the
        // end-to-end pipeline only.
        sw.Restart();

        var frame = await sse.WaitForFrameAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            Budget,
            cts.Token);
        var sseElapsed = sw.Elapsed;
        Assert.NotNull(frame);
        Assert.True(sseElapsed <= Budget,
            $"NFR-03 (SSE): first slot-update for {service}/{Environment} took {sseElapsed.TotalSeconds:F2}s (budget {Budget.TotalSeconds}s).");
        frame.Dispose();

        // Re-check the matrix view — the read-side echo MUST be visible
        // within the same envelope. Cap the residual budget at whatever
        // remains of the 5-second window.
        var residual = Budget - sseElapsed;
        if (residual < TimeSpan.FromMilliseconds(250)) residual = TimeSpan.FromMilliseconds(250);
        var slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out _),
            residual,
            cts.Token);
        Assert.NotNull(slot);
        Assert.True(sw.Elapsed <= Budget,
            $"NFR-03 (Read API): {service}/{Environment} matrix row took {sw.Elapsed.TotalSeconds:F2}s overall (budget {Budget.TotalSeconds}s).");
    }

    private static bool MatchesSlot(JsonElement env, string service, string environment)
        => env.TryGetProperty("service", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == service
        && env.TryGetProperty("environment", out var e) && e.ValueKind == JsonValueKind.String && e.GetString() == environment;
}
