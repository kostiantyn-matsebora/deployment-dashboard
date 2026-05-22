using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests.States;

/// <summary>
/// Asserts <c>state-id = running-failed-with-last</c>: in-progress event;
/// previous terminal is failure; older success exists.
/// Scenario: <c>scenarios/running-failed-with-last/</c> — env
/// <c>state-rfwl</c>; deps 31 (success), 32 (failure), 33 (in_progress).
/// </summary>
public sealed class RunningFailedWithLastStateTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "running-failed-with-last";
    private const string Environment = "state-rfwl";
    private const string ExpectedStateId = BoxStateOracle.RunningFailedWithLast;
    private const int    ExpectedSseCount = 3;
    private const long   LatestGhaDeploymentId = 33;
    private const string LatestSha = "cccc03300000000000000000000000000000cccc";

    private static readonly TimeSpan NfrLatencyBudget = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(30);

    private readonly ScenarioFixture _fixture;

    public RunningFailedWithLastStateTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Scenario_Resolves_To_RunningFailedWithLast_State_Id()
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
        Assert.True(DateTime.UtcNow - scenarioLoadedAt <= NfrLatencyBudget,
            $"NFR-03: first SSE frame for {service}/{Environment} exceeded {NfrLatencyBudget.TotalSeconds}s.");
        firstFrame.Dispose();

        var slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out var c) && c.GetProperty("status").GetString() == "in-progress"
                 && s.TryGetProperty("previousFailed", out var pf) && pf.ValueKind == JsonValueKind.True,
            PollBudget,
            cts.Token);
        Assert.NotNull(slot);
        Assert.Equal(ExpectedStateId, BoxStateOracle.ClassifyFromJson(slot!.Value));

        var totalCount = 1 + await sse.CountFramesAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            TimeSpan.FromSeconds(4),
            cts.Token);
        Assert.True(totalCount >= ExpectedSseCount,
            $"Expected >= {ExpectedSseCount} SSE frames for {service}/{Environment} (one per seeded deployment); saw {totalCount}.");

        using var history = await ReadApiAssertions.GetHistoryAsync(service, Environment, limit: 10, cts.Token);
        var latest = history.RootElement[0];
        Assert.Equal($"gha-{LatestGhaDeploymentId}", latest.GetProperty("deployment_id").GetString());
        Assert.Equal("in-progress", latest.GetProperty("status").GetString());
        Assert.Equal(LatestSha[..7], latest.GetProperty("version").GetString());
        Assert.Equal(LatestSha, latest.GetProperty("sha").GetString());
    }

    private static bool MatchesSlot(JsonElement env, string service, string environment)
        => env.TryGetProperty("service", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == service
        && env.TryGetProperty("environment", out var e) && e.ValueKind == JsonValueKind.String && e.GetString() == environment;
}
