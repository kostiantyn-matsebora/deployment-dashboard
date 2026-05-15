using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the matrix endpoint <c>GET /api/deployments</c> and
/// the per-slot endpoint <c>GET /api/deployments/{service}/{environment}</c>.
///
/// <para>Implements WBS MVP §3.2.2. The seed corpus (loaded by
/// <see cref="SeedFixture"/>) maps directly to the six box states from
/// <c>docs/deployment-dashboard.html</c>; each state has an explicit
/// assertion below.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class MatrixApiTests : IDisposable
{
    private readonly HttpClient _read;

    public MatrixApiTests()
    {
        _read = TestEnvironment.CreateReadClient();
    }

    public void Dispose() => _read.Dispose();

    // ----------------------------------------------------------------- envelope

    [Fact]
    public async Task GetMatrix_Returns200_AndIsKeyedByServiceAndEnvironment()
    {
        // Phase 2 wire shape per SAD §7 "Matrix response shape per
        // service": each service entry is an envelope with `envs`
        // (per-env slot map) and `topology` (per-service env DAG)
        // siblings, not the pre-Phase-2 flat env-keyed dictionary.
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Object, matrix.ValueKind);
        var serviceCount = 0;
        foreach (var svc in matrix.EnumerateObject())
        {
            serviceCount++;
            Assert.False(string.IsNullOrWhiteSpace(svc.Name));
            var node = svc.Value;
            Assert.Equal(JsonValueKind.Object, node.ValueKind);

            // `envs` sibling - the per-slot map (keyed by environment).
            Assert.True(node.TryGetProperty("envs", out var envs),
                $"Service '{svc.Name}' is missing the 'envs' sibling " +
                "(Phase 2 SAD wire shape: { envs, topology }).");
            Assert.Equal(JsonValueKind.Object, envs.ValueKind);
            var envCount = 0;
            foreach (var env in envs.EnumerateObject())
            {
                envCount++;
                Assert.False(string.IsNullOrWhiteSpace(env.Name));
                Assert.Equal(JsonValueKind.Object, env.Value.ValueKind);
                var slot = env.Value.Deserialize<MatrixSlot>(DashboardJson.Options);
                Assert.NotNull(slot);
                Assert.NotNull(slot!.Current);
                Assert.False(string.IsNullOrWhiteSpace(slot.Current.Status));
            }
            Assert.True(envCount > 0,
                $"Service '{svc.Name}' has no environments under 'envs'.");

            // `topology.edges` sibling - always present (possibly empty)
            // per SAD §7 "Matrix response shape - per service" and
            // §"Topology Derivation" Output.
            Assert.True(node.TryGetProperty("topology", out var topology),
                $"Service '{svc.Name}' is missing the 'topology' sibling " +
                "(Phase 2 SAD wire shape: { envs, topology }).");
            Assert.Equal(JsonValueKind.Object, topology.ValueKind);
            Assert.True(topology.TryGetProperty("edges", out var edges),
                $"Service '{svc.Name}' topology.edges is missing.");
            Assert.Equal(JsonValueKind.Array, edges.ValueKind);
        }
        Assert.True(serviceCount > 0, "Matrix must contain at least one service.");
    }

    // ----------------------------------------------------------------- six states

    [Fact]
    public async Task GetMatrix_State_Success_Has_NullLastSuccessful_AndFalsePreviousFailed()
    {
        var slot = await GetSlot("service-b", "dev");
        Assert.Equal("success", slot.Current.Status);
        Assert.Equal("v2.3.0", slot.Current.Version);
        Assert.Null(slot.LastSuccessful);
        Assert.False(slot.PreviousFailed);
    }

    [Fact]
    public async Task GetMatrix_State_RunningWithLastSuccessful_PopulatesLastSuccessful_AndPreviousFailedIsFalse()
    {
        var slot = await GetSlot("service-a", "dev");
        Assert.Equal("in-progress", slot.Current.Status);
        Assert.Equal("v2.3.2", slot.Current.Version);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v2.3.1", slot.LastSuccessful!.Version);
        Assert.False(slot.PreviousFailed);
    }

    [Fact]
    public async Task GetMatrix_State_RunningWithPrevFailedAndLastSuccessful_SetsPreviousFailedTrue()
    {
        var slot = await GetSlot("service-c", "dev");
        Assert.Equal("in-progress", slot.Current.Status);
        Assert.Equal("v3.1.2", slot.Current.Version);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v3.1.0", slot.LastSuccessful!.Version);
        Assert.True(slot.PreviousFailed);
    }

    [Fact]
    public async Task GetMatrix_State_FailedWithLastSuccessful_HasPreviousFailedFalse()
    {
        // previousFailed only ever fires when current is in-progress.
        var slot = await GetSlot("service-b", "qa");
        Assert.Equal("failure", slot.Current.Status);
        Assert.Equal("v1.7.9", slot.Current.Version);
        Assert.NotNull(slot.LastSuccessful);
        Assert.Equal("v1.7.8", slot.LastSuccessful!.Version);
        Assert.False(slot.PreviousFailed);
    }

    [Fact]
    public async Task GetMatrix_State_RunningNoHistory_HasNullLastSuccessful_AndFalsePreviousFailed()
    {
        var slot = await GetSlot("service-d", "uat");
        Assert.Equal("in-progress", slot.Current.Status);
        Assert.Equal("v4.0.4", slot.Current.Version);
        Assert.Null(slot.LastSuccessful);
        Assert.False(slot.PreviousFailed);
    }

    [Fact]
    public async Task GetMatrix_State_RunningWithPrevFailedNoSuccess_HasNullLastSuccessful_AndTruePreviousFailed()
    {
        var slot = await GetSlot("service-d", "dev");
        Assert.Equal("in-progress", slot.Current.Status);
        Assert.Equal("v4.0.3", slot.Current.Version);
        Assert.Null(slot.LastSuccessful);
        Assert.True(slot.PreviousFailed);
    }

    // ----------------------------------------------------------------- single slot

    [Fact]
    public async Task GetSlot_KnownSlot_Returns200()
    {
        var resp = await _read.GetAsync("/api/deployments/service-b/dev");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var slot = await resp.Content.ReadFromJsonAsync<MatrixSlot>(DashboardJson.Options);
        Assert.NotNull(slot);
        Assert.Equal("success", slot!.Current.Status);
    }

    [Fact]
    public async Task GetSlot_UnknownSlot_Returns404()
    {
        var resp = await _read.GetAsync("/api/deployments/unknown-service-xyz/unknown-env-zzz");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // ----------------------------------------------------------------- helpers

    private async Task<MatrixSlot> GetSlot(string service, string environment)
    {
        var resp = await _read.GetAsync($"/api/deployments/{service}/{environment}");
        Assert.True(
            resp.StatusCode == HttpStatusCode.OK,
            $"Expected 200 for {service}/{environment}; got {(int)resp.StatusCode}. " +
            "Ensure testing/scripts/seed.ps1 was run against the local stack.");
        var slot = await resp.Content.ReadFromJsonAsync<MatrixSlot>(DashboardJson.Options);
        Assert.NotNull(slot);
        return slot!;
    }
}
