using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests.States;

/// <summary>
/// Asserts <c>state-id = running</c>: in-progress deployment with no
/// prior history.
/// Scenario: <c>scenarios/running/</c> — env <c>state-running</c>;
/// single in_progress deployment id=51.
/// </summary>
public sealed class RunningStateTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "running";
    private const string Environment = "state-running";
    private const string ExpectedStateId = BoxStateOracle.Running;
    private const int    ExpectedSseCount = 1;
    private const long   LatestGhaDeploymentId = 51;
    private const string LatestSha = "eeee05100000000000000000000000000000eeee";

    private static readonly TimeSpan NfrLatencyBudget = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(15);

    private readonly ScenarioFixture _fixture;

    public RunningStateTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Scenario_Resolves_To_Running_State_Id()
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
                 && (!s.TryGetProperty("lastSuccessful", out var ls) || ls.ValueKind == JsonValueKind.Null),
            PollBudget,
            cts.Token);
        Assert.NotNull(slot);
        Assert.Equal(ExpectedStateId, BoxStateOracle.ClassifyFromJson(slot!.Value));

        var totalCount = 1 + await sse.CountFramesAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            TimeSpan.FromSeconds(2),
            cts.Token);
        Assert.True(totalCount >= ExpectedSseCount,
            $"Expected >= {ExpectedSseCount} SSE frame(s) for {service}/{Environment}; saw {totalCount}.");

        using var history = await ReadApiAssertions.GetHistoryAsync(service, Environment, limit: 10, cts.Token);
        var latest = history.RootElement[0];
        Assert.Equal($"gha-{LatestGhaDeploymentId}", latest.GetProperty("deployment_id").GetString());
        Assert.Equal("in-progress", latest.GetProperty("status").GetString());
        Assert.Equal(LatestSha[..7], latest.GetProperty("version").GetString());
    }

    private static bool MatchesSlot(JsonElement env, string service, string environment)
        => env.TryGetProperty("service", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == service
        && env.TryGetProperty("environment", out var e) && e.ValueKind == JsonValueKind.String && e.GetString() == environment;
}
