using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests.States;

/// <summary>
/// Asserts <c>state-id = failed-with-last</c>: most-recent event is
/// failure; an older terminal-success exists for the same slot.
/// Scenario: <c>scenarios/failed-with-last/</c> — env <c>state-fwl</c>;
/// deps 41 (success), 42 (failure, latest).
/// </summary>
public sealed class FailedWithLastStateTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "failed-with-last";
    private const string Environment = "state-fwl";
    private const string ExpectedStateId = BoxStateOracle.FailedWithLast;
    private const int    ExpectedSseCount = 2;
    private const long   LatestGhaDeploymentId = 42;
    private const string LatestSha = "dddd04200000000000000000000000000000dddd";

    private static readonly TimeSpan NfrLatencyBudget = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(30);

    private readonly ScenarioFixture _fixture;

    public FailedWithLastStateTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Scenario_Resolves_To_FailedWithLast_State_Id()
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
            s => s.TryGetProperty("current", out var c) && c.GetProperty("status").GetString() == "failure"
                 && s.TryGetProperty("lastSuccessful", out var ls) && ls.ValueKind == JsonValueKind.Object,
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
        Assert.Equal("failure", latest.GetProperty("status").GetString());
        Assert.Equal(LatestSha[..7], latest.GetProperty("version").GetString());
    }

    private static bool MatchesSlot(JsonElement env, string service, string environment)
        => env.TryGetProperty("service", out var s) && s.ValueKind == JsonValueKind.String && s.GetString() == service
        && env.TryGetProperty("environment", out var e) && e.ValueKind == JsonValueKind.String && e.GetString() == environment;
}
