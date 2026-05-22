using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests.States;

/// <summary>
/// Asserts <c>state-id = running-failed</c>: in-progress event; previous
/// terminal is failure; no successful history exists for the slot.
/// Scenario: <c>scenarios/running-failed/</c> — env <c>state-rf</c>;
/// deps 61 (failure), 62 (in_progress, latest); no prior success.
/// </summary>
public sealed class RunningFailedStateTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "running-failed";
    private const string Environment = "state-rf";
    private const string ExpectedStateId = BoxStateOracle.RunningFailed;
    private const int    ExpectedSseCount = 2;
    private const long   LatestGhaDeploymentId = 62;
    private const string LatestSha = "ffff06200000000000000000000000000000ffff";

    private static readonly TimeSpan NfrLatencyBudget = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(15);

    private readonly ScenarioFixture _fixture;

    public RunningFailedStateTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Scenario_Resolves_To_RunningFailed_State_Id()
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
                 && s.TryGetProperty("previousFailed", out var pf) && pf.ValueKind == JsonValueKind.True
                 && (!s.TryGetProperty("lastSuccessful", out var ls) || ls.ValueKind == JsonValueKind.Null),
            PollBudget,
            cts.Token);
        Assert.NotNull(slot);
        Assert.Equal(ExpectedStateId, BoxStateOracle.ClassifyFromJson(slot!.Value));

        var totalCount = 1 + await sse.CountFramesAsync(
            envelope => MatchesSlot(envelope, service, Environment),
            TimeSpan.FromSeconds(3),
            cts.Token);
        Assert.True(totalCount >= ExpectedSseCount,
            $"Expected >= {ExpectedSseCount} SSE frames for {service}/{Environment}; saw {totalCount}.");

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
