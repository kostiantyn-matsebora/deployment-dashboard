using System;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests.States;

/// <summary>
/// Asserts the inbound write path against <c>state-id = running-with-last</c>:
/// in-progress deployment + earlier terminal-success on the same slot.
/// Scenario: <c>scenarios/running-with-last/</c> — env <c>state-rwl</c>;
/// dep 21 (success, older) + dep 22 (in_progress, latest).
/// </summary>
public sealed class RunningWithLastStateTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "running-with-last";
    private const string Environment = "state-rwl";
    private const string ExpectedStateId = BoxStateOracle.RunningWithLast;
    private const int    ExpectedSseCount = 2;
    private const long   LatestGhaDeploymentId = 22;
    private const string LatestSha = "bbbb02200000000000000000000000000000bbbb";
    private const string LatestActor = "mock-gha-actor";

    private static readonly TimeSpan NfrLatencyBudget = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(30);

    private readonly ScenarioFixture _fixture;

    public RunningWithLastStateTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Scenario_Resolves_To_RunningWithLast_State_Id()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var service = TestEnvironment.PrimaryOwnerRepo.Repo;

        await using var sse = await SseListener.OpenAsync(cts.Token);

        var scenarioLoadedAt = DateTime.UtcNow;
        await _fixture.LoadScenarioAsync(ScenarioName, cts.Token);

        var firstFrame = await sse.WaitForFrameAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            NfrLatencyBudget,
            cts.Token);
        Assert.NotNull(firstFrame);
        var firstFrameAt = DateTime.UtcNow;
        Assert.True(firstFrameAt - scenarioLoadedAt <= NfrLatencyBudget,
            $"NFR-03: first SSE frame for {service}/{Environment} arrived {(firstFrameAt - scenarioLoadedAt).TotalSeconds:F2}s after scenario load.");
        firstFrame.Dispose();

        var slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out var c) &&
                 c.GetProperty("status").GetString() == "in-progress",
            PollBudget,
            cts.Token);
        Assert.NotNull(slot);
        Assert.Equal(ExpectedStateId, BoxStateOracle.ClassifyFromJson(slot!.Value));

        var totalCount = 1 + await sse.CountFramesAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            TimeSpan.FromSeconds(3),
            cts.Token);
        Assert.True(totalCount >= ExpectedSseCount,
            $"Expected >= {ExpectedSseCount} SSE frame(s) for {service}/{Environment} (one per seeded deployment); saw {totalCount}.");

        // FR-06 wire-shape on the latest deployment (the in_progress one).
        using var history = await ReadApiAssertions.GetHistoryAsync(service, Environment, limit: 10, cts.Token);
        var latest = history.RootElement[0];
        Assert.Equal($"gha-{LatestGhaDeploymentId}", latest.GetProperty("deployment_id").GetString());
        Assert.Equal("in-progress", latest.GetProperty("status").GetString());
        Assert.Equal(LatestSha[..7], latest.GetProperty("version").GetString());
        Assert.Equal(LatestActor, latest.GetProperty("actor").GetString());
        Assert.Equal(LatestSha, latest.GetProperty("sha").GetString());
    }

    private static bool MatchesSlot(JsonElement env, string service, string environment)
        => env.TryGetProperty("service", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == service
        && env.TryGetProperty("environment", out var e) && e.ValueKind == JsonValueKind.String && e.GetString() == environment;
}
