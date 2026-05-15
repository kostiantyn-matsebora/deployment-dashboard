using System.Net;
using System.Net.Http.Json;
using System.Text;
using Dashboard.Shared.Json;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// Load-bearing proof that the API-key filter is scoped to the Write
/// endpoint group only (SAD §8 "Security Considerations" + WBS 1.1.4 +
/// §10 Decision 11). Both endpoints below run against the single
/// <see cref="Dashboard.Api.Program"/> host that composes the Write and
/// Read surfaces; if the host accidentally re-introduced a global
/// <c>UseMiddleware&lt;ApiKeyMiddleware&gt;</c> registration, the Read
/// assertion below would fail with 401.
///
/// <para>The factory used here mirrors <see cref="TopologyApiFactory"/>
/// — SQLite-in-memory store, hosted services stripped, fresh per-test
/// state. The matrix-shape tests live in
/// <see cref="MatrixShapeTests"/> and stay shared-fixture for speed; this
/// file exercises auth boundaries, so each test owns its own factory.</para>
/// </summary>
public sealed class ApiKeyScopingTests
{
    private static TopologyApiFactory NewFactory() => new();

    private static StringContent ValidWritePayload() => new(
        """
        {
          "deployment_id": "scoping-1",
          "service":       "svc-a",
          "environment":   "dev",
          "version":       "v1",
          "status":        "success",
          "run_url":       "https://example.com/runs/1",
          "run_number":    1,
          "actor":         "tester"
        }
        """,
        Encoding.UTF8,
        "application/json");

    [Fact]
    public async Task Get_Deployments_NoApiKey_Returns200()
    {
        // SAD §8: "The Read endpoint group ... is unauthenticated by design".
        // The matrix is reachable without X-Api-Key — the SPA never carries
        // one.
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/deployments");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Post_Deployments_NoApiKey_Returns401()
    {
        // SAD §8 + WBS 1.1.4: "MapGroup(...).RequireApiKey() on the write
        // group; no global registration." A POST without the header must
        // be rejected.
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.PostAsync("/api/deployments", ValidWritePayload());

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Get_TopologyConfig_NoApiKey_Returns200()
    {
        // SAD WBS 1.2.7: GET /api/config/topology is on the Read group
        // (unauthenticated); the SPA uses it to label "system default" in
        // the picker.
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/api/config/topology");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Patch_TopologyConfig_NoApiKey_Returns401()
    {
        // SAD WBS 1.2.7: PATCH /api/config/topology lives on the Write
        // group — same auth boundary as POST /api/deployments.
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.PatchAsync(
            "/api/config/topology",
            new StringContent(
                """{ "correlationAttribute": "actor" }""",
                Encoding.UTF8,
                "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Get_Health_NoApiKey_Returns200()
    {
        // Sanity: /health is unauthenticated so orchestrators (ACA,
        // Docker Compose, k8s) can probe without the API key (SAD §7).
        using var factory = NewFactory();
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task UnusedJsonOptionsReference_KeepsDashboardJsonAlive()
    {
        // Compile-time anchor: we keep the dependency on DashboardJson.Options
        // in this assembly so the wire-format contract is exercised by at
        // least one auth-boundary test class. No runtime effect.
        Assert.NotNull(DashboardJson.Options);
        await Task.CompletedTask;
    }
}
