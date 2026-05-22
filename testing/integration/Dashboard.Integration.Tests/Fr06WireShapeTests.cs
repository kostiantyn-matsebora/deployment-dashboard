using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Verifies FR-06 — the upstream → write-API → DB → read-API pipeline
/// preserves the full deployment-event wire shape losslessly.
///
/// <para><b>Scenario corpus.</b>
/// <c>scenarios/_cross-cutting/fr-06-wire-shape/</c> — a single
/// every-field-populated deployment id=151 on env=<c>state-wireshape</c>.
/// All optional fields (sha, ref, creator.login, status log_url +
/// target_url) are populated.</para>
///
/// <para><b>Assertion seam.</b> Per CR-0012 § "FR-06 assertion seam":
/// Read-side echo (Option b) — fetch
/// <c>GET /api/deployments/{service}/{environment}/history</c> and
/// verify every documented field. Avoids double-mocking the write API
/// via WireMock; the persistence + DTO mapping path proves the wire
/// is lossless end-to-end.</para>
/// </summary>
public sealed class Fr06WireShapeTests : IClassFixture<ScenarioFixture>
{
    private const string ScenarioName = "_cross-cutting/fr-06-wire-shape";
    private const string Environment = "state-wireshape";
    private const long   ExpectedDeploymentId = 151;
    private const string ExpectedSha = "1515015100000000000000000000000000001515";
    private const string ExpectedRef = "release/wire-shape-check";
    private const string ExpectedActor = "mock-gha-author";

    private static readonly TimeSpan PollBudget = TimeSpan.FromSeconds(30);

    private readonly ScenarioFixture _fixture;

    public Fr06WireShapeTests(ScenarioFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Read_Side_History_Echoes_Every_Field_From_Upstream_Mock_Gha()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        var service = TestEnvironment.PrimaryOwnerRepo.Repo;

        await _fixture.LoadScenarioAsync(ScenarioName, cts.Token);

        var slot = await ReadApiAssertions.WaitForSlotAsync(
            service, Environment,
            s => s.TryGetProperty("current", out var c) &&
                 c.GetProperty("deployment_id").GetString() == $"gha-{ExpectedDeploymentId}",
            PollBudget,
            cts.Token);
        Assert.NotNull(slot);

        using var history = await ReadApiAssertions.GetHistoryAsync(service, Environment, limit: 10, cts.Token);
        Assert.Equal(JsonValueKind.Array, history.RootElement.ValueKind);
        Assert.True(history.RootElement.GetArrayLength() >= 1);
        var ev = history.RootElement[0];

        // Every documented field on DeploymentEventResponse must be
        // present and faithful to the upstream mock-gha source.
        AssertField(ev, "id",                JsonValueKind.Number);
        Assert.Equal($"gha-{ExpectedDeploymentId}", ev.GetProperty("deployment_id").GetString());
        Assert.Equal(service,                 ev.GetProperty("service").GetString());
        Assert.Equal(Environment,             ev.GetProperty("environment").GetString());
        Assert.Equal(ExpectedSha[..7],        ev.GetProperty("version").GetString());
        Assert.Equal("success",               ev.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(ev.GetProperty("run_url").GetString()));
        Assert.Equal(ExpectedDeploymentId,    ev.GetProperty("run_number").GetInt64());
        Assert.Equal(ExpectedActor,           ev.GetProperty("actor").GetString());
        AssertField(ev, "deployed_at",       JsonValueKind.String);
        AssertField(ev, "parent_deployments",JsonValueKind.Array);
        Assert.Equal(ExpectedRef,             ev.GetProperty("ref").GetString());
        Assert.Equal(ExpectedSha,             ev.GetProperty("sha").GetString());
        // progress_reporter is always present; null when no
        // X-Progress-Reporter header was supplied by the writer.
        Assert.True(ev.TryGetProperty("progress_reporter", out _),
            "FR-06 wire-shape: progress_reporter must always be emitted (present-with-null when not supplied).");

        // Run URL precedence — adapter prefers log_url over target_url; the
        // scenario populates both with distinct values so we can prove
        // the precedence held end-to-end.
        var runUrl = ev.GetProperty("run_url").GetString();
        Assert.Equal(
            "https://github.com/integration-test-org/integration-test-repo/actions/runs/1000151/job/wire-shape",
            runUrl);
    }

    private static void AssertField(JsonElement parent, string name, JsonValueKind expectedKind)
    {
        Assert.True(parent.TryGetProperty(name, out var prop),
            $"FR-06 wire-shape: field '{name}' is absent from the read-side echo.");
        Assert.Equal(expectedKind, prop.ValueKind);
    }
}
