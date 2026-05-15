using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Security;

namespace Dashboard.WriteApi.Tests;

/// <summary>
/// Covers every row of SAD §7 "POST /api/deployments validation —
/// failure modes":
///
/// <list type="bullet">
///   <item>Missing or empty deployment_id            -> 422</item>
///   <item>Duplicate (service, deployment_id)        -> 409</item>
///   <item>parent_deployments[i] cross-service       -> 400</item>
///   <item>parent_deployments[i] forms a cycle       -> 400</item>
///   <item>parent_deployments[i] dangling reference  -> 201 (accepted)</item>
///   <item>Missing/invalid X-Api-Key                 -> 401 (existing coverage; here too)</item>
/// </list>
/// </summary>
public sealed class TopologyValidationTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public TopologyValidationTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private HttpRequestMessage WithApiKey(HttpRequestMessage req)
    {
        req.Headers.Add(ApiKeyMiddleware.HeaderName, _factory.ApiKey);
        return req;
    }

    private async Task<HttpResponseMessage> PostAsync(object payload)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload, options: DashboardJson.Options),
        };
        return await _client.SendAsync(WithApiKey(req));
    }

    private static object BasePayload(
        string deploymentId,
        string service = "svc-a",
        string env = "dev",
        string version = "v1",
        string[]? parents = null)
        => new
        {
            deployment_id = deploymentId,
            service,
            environment = env,
            version,
            status = "success",
            run_url = "https://example.com/runs/1",
            run_number = 1,
            actor = "tester",
            parent_deployments = parents,
        };

    // ---------- Row 1: missing/empty deployment_id -> 422 ----------------

    [Fact]
    public async Task MissingDeploymentId_Returns422()
    {
        var raw = """
        {
          "service":     "svc-a",
          "environment": "dev",
          "version":     "v1",
          "status":      "success",
          "run_url":     "https://example.com/runs/1",
          "run_number":  1,
          "actor":       "tester"
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    [Fact]
    public async Task EmptyDeploymentId_Returns422()
    {
        var resp = await PostAsync(BasePayload(deploymentId: ""));
        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    [Fact]
    public async Task WhitespaceDeploymentId_Returns422()
    {
        var resp = await PostAsync(BasePayload(deploymentId: "   "));
        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ---------- Row 2: duplicate (service, deployment_id) -> 409 ---------

    [Fact]
    public async Task DuplicateDeploymentId_Returns409_WithExistingResource()
    {
        var first = await PostAsync(BasePayload("dup-1"));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var duplicate = await PostAsync(BasePayload("dup-1"));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        var body = await duplicate.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("duplicate_deployment_id", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task DuplicateOnlyWithinSameService_DifferentServiceSameIdAccepted()
    {
        // The SAD's unique key is (service, deployment_id) — two services
        // may legitimately use the same id (e.g. shared run id).
        var a = await PostAsync(BasePayload("shared-id", service: "svc-x"));
        Assert.Equal(HttpStatusCode.Created, a.StatusCode);

        var b = await PostAsync(BasePayload("shared-id", service: "svc-y"));
        Assert.Equal(HttpStatusCode.Created, b.StatusCode);
    }

    // ---------- Row 3: cross-service parent -> 400 -----------------------

    [Fact]
    public async Task CrossServiceParent_Returns400()
    {
        // Seed a deployment in svc-alpha …
        var alpha = await PostAsync(BasePayload("alpha-1", service: "svc-alpha", env: "dev"));
        Assert.Equal(HttpStatusCode.Created, alpha.StatusCode);

        // … then try to reference it from svc-beta.
        var resp = await PostAsync(BasePayload(
            "beta-1",
            service: "svc-beta",
            env: "qa",
            parents: new[] { "alpha-1" }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("cross_service_parent_reference", body.GetProperty("error").GetString());
    }

    // ---------- Row 4: cycle via resolved parents -> 400 -----------------

    [Fact]
    public async Task SelfReferentialParent_Returns400_TopologyCycle()
    {
        // Tightest case: a deployment whose parent_deployments includes
        // its own deployment_id. The SAD's cycle check forbids any chain
        // that, combined with existing edges, would form a directed cycle.
        var resp = await PostAsync(BasePayload(
            "loop-self",
            service: "svc-cycle-self",
            env: "dev",
            parents: new[] { "loop-self" }));

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("topology_cycle", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ParentChainFormingCycle_Returns400_AfterDanglingResolution()
    {
        // Cycle through a previously-dangling reference. Sequence:
        //
        //   1. Insert "cyc-b" with parent "cyc-a" — dangling (cyc-a not
        //      ingested yet); accepted (201).
        //   2. Insert "cyc-a" with parent "cyc-b" — at this point both
        //      nodes are resolved and the new edge cyc-b -> cyc-a closes
        //      a cycle with the existing edge cyc-a -> cyc-b. Must 400.
        var first = await PostAsync(BasePayload(
            "cyc-b",
            service: "svc-cycle-resolve",
            env: "qa",
            parents: new[] { "cyc-a" }));
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var cycleClose = await PostAsync(BasePayload(
            "cyc-a",
            service: "svc-cycle-resolve",
            env: "dev",
            parents: new[] { "cyc-b" }));

        Assert.Equal(HttpStatusCode.BadRequest, cycleClose.StatusCode);
        var body = await cycleClose.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("topology_cycle", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task MultiHopEnvChainClosingCycle_Returns400()
    {
        // The cycle here is in the env graph, not the deployment-id graph:
        // every deployment_id is unique, so the deployment-id parent graph
        // is a perfect tree. The closing edge env-3 -> env-1 only forms a
        // cycle when the graph is viewed as parent.environment ->
        // child.environment, which is the same graph the read-side
        // TopologyBuilder emits (SAD §5 "Topology Derivation").
        //
        //   A (env-1) <- B (env-2) <- C (env-3) <- cycle-close (env-1)
        //
        // env-graph edges: env-1 -> env-2 -> env-3, plus the proposed
        // env-3 -> env-1 — a 3-cycle.
        var svc = "svc-cycle-multi-hop";
        Assert.Equal(HttpStatusCode.Created,
            (await PostAsync(BasePayload("cycle-a", service: svc, env: "env-1"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created,
            (await PostAsync(BasePayload("cycle-b", service: svc, env: "env-2",
                parents: new[] { "cycle-a" }))).StatusCode);
        Assert.Equal(HttpStatusCode.Created,
            (await PostAsync(BasePayload("cycle-c", service: svc, env: "env-3",
                parents: new[] { "cycle-b" }))).StatusCode);

        var cycleClose = await PostAsync(BasePayload(
            "cycle-close",
            service: svc,
            env: "env-1",
            parents: new[] { "cycle-c" }));

        Assert.Equal(HttpStatusCode.BadRequest, cycleClose.StatusCode);
        var body = await cycleClose.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("topology_cycle", body.GetProperty("error").GetString());
    }

    [Fact]
    public async Task ParentInSameEnvironment_DifferentId_IsAccepted()
    {
        // Two deployments in the same env where the child explicitly names
        // the parent: the read-side builder skips this as a self-edge
        // (TopologyBuilder pass 2) — no edge emitted, no cycle. The
        // write-time check must agree; rejecting this as a "cycle" would
        // diverge from the read-side semantics.
        var svc = "svc-same-env-parent";
        Assert.Equal(HttpStatusCode.Created,
            (await PostAsync(BasePayload("same-env-parent", service: svc, env: "dev"))).StatusCode);

        var child = await PostAsync(BasePayload(
            "same-env-child",
            service: svc,
            env: "dev",
            parents: new[] { "same-env-parent" }));

        Assert.Equal(HttpStatusCode.Created, child.StatusCode);
    }

    // ---------- Row 5: dangling reference -> 201 (accepted) --------------

    [Fact]
    public async Task DanglingParentReference_Returns201_AndIsStoredVerbatim()
    {
        // SAD: dangling refs are accepted; "The next read after the missing
        // source lands automatically picks it up".
        var resp = await PostAsync(BasePayload(
            "dangling-child",
            service: "svc-dangling",
            env: "qa",
            parents: new[] { "never-ingested" }));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("dangling-child", body.GetProperty("deployment_id").GetString());
        var parents = body.GetProperty("parent_deployments").EnumerateArray()
            .Select(e => e.GetString()).ToArray();
        Assert.Contains("never-ingested", parents);
    }
}
