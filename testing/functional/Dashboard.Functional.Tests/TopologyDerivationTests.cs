using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the read-side topology derivation documented in
/// SAD §5 "Topology Derivation". Exercises every derivation path:
/// <list type="bullet">
///   <item>Pure-explicit chain - every promotion event has
///         <c>parent_deployments</c>. Builder emits edges with
///         <c>source: "explicit"</c>.</item>
///   <item>Pure-correlated - no <c>parent_deployments</c>, shared
///         correlation attribute. Builder emits
///         <c>source: "correlated"</c>.</item>
///   <item>Mixed - both kinds in one service.</item>
///   <item>Dangling-then-resolved is covered by
///         <see cref="ValidationFailureModesTests"/>.</item>
/// </list>
///
/// <para>The corpus comes from the <c>topology[]</c> section of
/// <c>testing/fixtures/seed-data.json</c> which
/// <c>testing/scripts/seed.ps1</c> POSTs alongside the 6-box-state
/// corpus.</para>
///
/// <para>Wire-format reference: SAD §7 "Matrix response shape per
/// service" -
/// <c>{ envs, topology: { edges: [{ from, to, source }] } }</c>.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class TopologyDerivationTests : IDisposable
{
    private readonly HttpClient _read;

    public TopologyDerivationTests() => _read = TestEnvironment.CreateReadClient();

    public void Dispose() => _read.Dispose();

    [Fact]
    public async Task PureExplicit_EmitsExplicitEdgesOnly()
    {
        var edges = await GetServiceEdgesAsync("topo-explicit");

        // Per fixture: dev -> qa -> prod, both explicit.
        AssertHasEdge(edges, "dev", "qa", "explicit");
        AssertHasEdge(edges, "qa", "prod", "explicit");

        // No 'correlated' edges should slip into a pure-explicit service.
        foreach (var e in edges.EnumerateArray())
        {
            Assert.NotEqual("correlated", e.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task PureCorrelated_EmitsCorrelatedEdgesOnly()
    {
        var edges = await GetServiceEdgesAsync("topo-correlated");

        AssertHasEdge(edges, "dev", "qa", "correlated");
        AssertHasEdge(edges, "qa", "prod", "correlated");

        // Pure-correlated service - no explicit edges anywhere.
        foreach (var e in edges.EnumerateArray())
        {
            Assert.NotEqual("explicit", e.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task Mixed_ExplicitAndCorrelatedCoexistOnDistinctEdges()
    {
        var edges = await GetServiceEdgesAsync("topo-mixed");

        // dev->qa came in with parent_deployments -> explicit.
        AssertHasEdge(edges, "dev", "qa", "explicit");
        // qa->prod has no parent_deployments but shares version v3.0.0 ->
        // correlated.
        AssertHasEdge(edges, "qa", "prod", "correlated");
    }

    [Fact]
    public async Task MatrixResponseShape_PerService_HasEnvsAndTopology()
    {
        // Sanity assertion against SAD §7 "Matrix response shape per
        // service": each service entry is an object with `envs` and
        // `topology` sibling keys, not a flat env-keyed dictionary.
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();

        foreach (var svc in matrix.EnumerateObject())
        {
            var node = svc.Value;
            Assert.Equal(JsonValueKind.Object, node.ValueKind);

            Assert.True(node.TryGetProperty("envs", out var envs),
                $"Service '{svc.Name}' is missing the 'envs' sibling. " +
                "Phase 2 SAD wire shape: { envs, topology }.");
            Assert.Equal(JsonValueKind.Object, envs.ValueKind);

            Assert.True(node.TryGetProperty("topology", out var topo),
                $"Service '{svc.Name}' is missing the 'topology' sibling. " +
                "Phase 2 SAD wire shape: { envs, topology }.");
            Assert.True(topo.TryGetProperty("edges", out var edges),
                $"Service '{svc.Name}' topology.edges is missing.");
            Assert.Equal(JsonValueKind.Array, edges.ValueKind);

            // Every edge must carry exactly the documented shape.
            foreach (var edge in edges.EnumerateArray())
            {
                Assert.Equal(JsonValueKind.Object, edge.ValueKind);
                Assert.True(edge.TryGetProperty("from", out var from));
                Assert.True(edge.TryGetProperty("to", out var to));
                Assert.True(edge.TryGetProperty("source", out var source));
                Assert.Equal(JsonValueKind.String, from.ValueKind);
                Assert.Equal(JsonValueKind.String, to.ValueKind);
                Assert.Equal(JsonValueKind.String, source.ValueKind);
                var src = source.GetString();
                Assert.True(src == "explicit" || src == "correlated",
                    $"edge.source '{src}' must be either 'explicit' or 'correlated'.");
                // from and to must both reference real envs in this service.
                Assert.True(envs.TryGetProperty(from.GetString()!, out _),
                    $"Service '{svc.Name}' has edge.from='{from.GetString()}' " +
                    "not present in its envs map.");
                Assert.True(envs.TryGetProperty(to.GetString()!, out _),
                    $"Service '{svc.Name}' has edge.to='{to.GetString()}' " +
                    "not present in its envs map.");
            }
        }
    }

    [Fact]
    public async Task PerSlot_CurrentExposesDeploymentIdAndParentDeployments()
    {
        // SAD §7 "Matrix response shape per service" - the per-slot
        // 'current' object now carries 'deployment_id' (always) and
        // 'parent_deployments' (array, possibly empty).
        var edges = await GetServiceEnvsAsync("topo-explicit");
        var qa = edges["qa"];
        Assert.True(qa.TryGetProperty("current", out var current));
        Assert.True(current.TryGetProperty("deployment_id", out var depId));
        Assert.Equal("topo-exp-qa-1", depId.GetString());

        Assert.True(current.TryGetProperty("parent_deployments", out var parents),
            "current.parent_deployments must be surfaced on the wire (SAD §7).");
        Assert.Equal(JsonValueKind.Array, parents.ValueKind);
        var parentIds = parents.EnumerateArray().Select(p => p.GetString()).ToList();
        Assert.Contains("topo-exp-dev-1", parentIds);
    }

    // ----------------------------------------------------- helpers

    private async Task<JsonElement> GetServiceEdgesAsync(string service)
    {
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(matrix.TryGetProperty(service, out var svc),
            $"Matrix missing service '{service}' - run testing/scripts/seed.ps1 first.");
        Assert.True(svc.TryGetProperty("topology", out var topo));
        Assert.True(topo.TryGetProperty("edges", out var edges));
        Assert.Equal(JsonValueKind.Array, edges.ValueKind);
        return edges;
    }

    private async Task<IReadOnlyDictionary<string, JsonElement>> GetServiceEnvsAsync(string service)
    {
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(matrix.TryGetProperty(service, out var svc));
        Assert.True(svc.TryGetProperty("envs", out var envs));
        var dict = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var env in envs.EnumerateObject())
        {
            dict[env.Name] = env.Value;
        }
        return dict;
    }

    private static void AssertHasEdge(JsonElement edgesArray, string from, string to, string source)
    {
        foreach (var e in edgesArray.EnumerateArray())
        {
            if (e.GetProperty("from").GetString() == from &&
                e.GetProperty("to").GetString() == to &&
                e.GetProperty("source").GetString() == source)
            {
                return;
            }
        }
        Assert.Fail(
            $"Expected edge {from} -> {to} (source={source}) not found in topology. " +
            "If you just changed the topology derivation algorithm, check SAD §5 " +
            "'Topology Derivation' before adjusting this assertion - the SAD is the contract.");
    }
}
