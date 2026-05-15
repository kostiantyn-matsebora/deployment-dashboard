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
/// Functional tests for the topology builder's correlation-fallback pass
/// when the per-request hint selects <c>ref</c> or <c>sha</c>. Companion
/// to <see cref="TopologyDerivationTests"/> (correlated-by-version) and
/// <see cref="MatrixCorrelationQueryParamTests"/> (query-param plumbing).
///
/// <para>This suite asserts the EDGE SET, not just envelope shape: the
/// fixture corpus deliberately puts the correlation signal on
/// <c>ref</c> / <c>sha</c> ONLY — every event in the two new services
/// (<c>topo-ref-correlated</c>, <c>topo-sha-correlated</c>) has a
/// DISTINCT <c>version</c> per env, so the default
/// <c>correlationAttribute=version</c> derives ZERO edges. The hint
/// <c>?correlationAttribute=ref</c> (or <c>=sha</c>) must surface two
/// correlated edges per service (dev-&gt;qa, qa-&gt;prod). This is what
/// "the read API actually consults <c>ref</c>/<c>sha</c>" looks like as
/// an observable behaviour.</para>
///
/// <para>Citations:
/// <list type="bullet">
///   <item>SAD §5 "Topology Derivation" pass 3 (correlation fallback):
///         <c>P.&lt;correlation-attribute&gt;</c> equals
///         <c>D.&lt;correlation-attribute&gt;</c>.</item>
///   <item>SAD §7 "GET /api/deployments — query parameters":
///         <c>correlationAttribute</c> per-request hint, allowed values
///         <c>{version, ref, sha, actor, run, ago}</c>.</item>
///   <item>SAD §4 FR-02 (seven-attribute set) and FR-13 (Topology
///         correlation picker exposing <c>ref</c>/<c>sha</c>).</item>
/// </list>
/// </para>
///
/// <para>Fixture: <c>testing/fixtures/seed-data.json</c>'s
/// <c>topology[]</c> array — see <c>topo-ref-correlated</c> and
/// <c>topo-sha-correlated</c> blocks.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class TopologyCorrelationByRefShaTests : IDisposable
{
    private readonly HttpClient _read;

    public TopologyCorrelationByRefShaTests() => _read = TestEnvironment.CreateReadClient();

    public void Dispose() => _read.Dispose();

    [Fact]
    public async Task RefCorrelated_DefaultByVersion_YieldsNoEdges_BecauseVersionsDiffer()
    {
        // Sanity floor: with the default correlationAttribute=version
        // the fixture rows for topo-ref-correlated do NOT share a version
        // across envs (v7.1.0 / v7.1.1 / v7.1.2), and they carry no
        // parent_deployments. The correlation-fallback pass must therefore
        // find NO matches and emit zero edges. If this assertion fails
        // (edges appear without an explicit hint), the topology builder is
        // either using a non-version default or the fixture wasn't seeded
        // — either way the downstream `=ref` test below is unsafe.
        var edges = await GetServiceEdgesAsync(service: "topo-ref-correlated", correlationAttribute: null);
        Assert.Equal(0, edges.GetArrayLength());
    }

    [Fact]
    public async Task RefCorrelated_WithCorrelationAttributeRef_EmitsTwoCorrelatedEdges()
    {
        // Per SAD §5 pass 3: with ?correlationAttribute=ref, the
        // correlation-fallback pass MUST find the shared ref value
        // ("release/2026.05") across dev / qa / prod and emit the two
        // chronologically adjacent edges. version is deliberately
        // distinct per event so any edge here can ONLY come from the
        // ref-driven correlation path.
        var edges = await GetServiceEdgesAsync("topo-ref-correlated", correlationAttribute: "ref");

        AssertHasEdge(edges, "dev", "qa", "correlated");
        AssertHasEdge(edges, "qa", "prod", "correlated");

        // No explicit edges should appear (the fixture omits
        // parent_deployments for every event).
        foreach (var e in edges.EnumerateArray())
        {
            Assert.NotEqual("explicit", e.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task ShaCorrelated_DefaultByVersion_YieldsNoEdges_BecauseVersionsDiffer()
    {
        // Mirror of RefCorrelated_Default_NoEdges for the sha axis.
        var edges = await GetServiceEdgesAsync("topo-sha-correlated", correlationAttribute: null);
        Assert.Equal(0, edges.GetArrayLength());
    }

    [Fact]
    public async Task ShaCorrelated_WithCorrelationAttributeSha_EmitsTwoCorrelatedEdges()
    {
        // Same construction as RefCorrelated_WithCorrelationAttributeRef
        // but on the sha axis. ref values differ per event (so
        // ?correlationAttribute=ref would emit zero), version values
        // differ per event (so default correlationAttribute=version
        // would emit zero), and only sha is shared — so an edge here
        // proves the builder consulted sha.
        var edges = await GetServiceEdgesAsync("topo-sha-correlated", correlationAttribute: "sha");

        AssertHasEdge(edges, "dev", "qa", "correlated");
        AssertHasEdge(edges, "qa", "prod", "correlated");

        foreach (var e in edges.EnumerateArray())
        {
            Assert.NotEqual("explicit", e.GetProperty("source").GetString());
        }
    }

    [Fact]
    public async Task ShaCorrelated_WithCorrelationAttributeRef_YieldsNoEdges_BecauseRefsDiffer()
    {
        // Cross-axis negative case: the topo-sha-correlated service has
        // a DISTINCT ref per event (feature/sha-dev / feature/sha-qa /
        // feature/sha-prod) — so requesting ?correlationAttribute=ref
        // on this service must surface ZERO edges. This pins the rule
        // that the builder respects the requested attribute and does
        // not silently fall through to a different attribute when the
        // requested one yields no matches.
        var edges = await GetServiceEdgesAsync("topo-sha-correlated", correlationAttribute: "ref");
        Assert.Equal(0, edges.GetArrayLength());
    }

    [Fact]
    public async Task PerSlot_RefAndSha_AreSurfacedOnTheWire_ForCorrelatedServices()
    {
        // Companion assertion: the per-slot 'current' for the new
        // correlated-by-ref / correlated-by-sha services must round-trip
        // ref + sha exactly as posted. This is the wire-shape oracle
        // for the new fixture rows — if any of these fail, the SPA
        // would have nothing to render even with the picker selecting
        // ref or sha. Per SAD §7 "Matrix response shape — per service"
        // field rules.
        var matrix = await GetMatrixAsync(correlationAttribute: null);

        // topo-ref-correlated: every event shares ref="release/2026.05".
        AssertCurrentField(matrix, "topo-ref-correlated", "dev",  field: "ref", expected: "release/2026.05");
        AssertCurrentField(matrix, "topo-ref-correlated", "qa",   field: "ref", expected: "release/2026.05");
        AssertCurrentField(matrix, "topo-ref-correlated", "prod", field: "ref", expected: "release/2026.05");
        // Per-env sha is distinct (the row identity carries it).
        AssertCurrentField(matrix, "topo-ref-correlated", "dev",  field: "sha", expected: "aaaa111100");
        AssertCurrentField(matrix, "topo-ref-correlated", "prod", field: "sha", expected: "cccc333300");

        // topo-sha-correlated: every event shares sha="a1b2c3d4e5f6".
        AssertCurrentField(matrix, "topo-sha-correlated", "dev",  field: "sha", expected: "a1b2c3d4e5f6");
        AssertCurrentField(matrix, "topo-sha-correlated", "qa",   field: "sha", expected: "a1b2c3d4e5f6");
        AssertCurrentField(matrix, "topo-sha-correlated", "prod", field: "sha", expected: "a1b2c3d4e5f6");
        // Per-env ref is distinct.
        AssertCurrentField(matrix, "topo-sha-correlated", "dev",  field: "ref", expected: "feature/sha-dev");
        AssertCurrentField(matrix, "topo-sha-correlated", "prod", field: "ref", expected: "feature/sha-prod");
    }

    // ----------------------------------------------------- helpers

    private async Task<JsonElement> GetServiceEdgesAsync(string service, string? correlationAttribute)
    {
        var matrix = await GetMatrixAsync(correlationAttribute);
        Assert.True(matrix.TryGetProperty(service, out var svc),
            $"Matrix missing service '{service}' — run testing/scripts/seed.ps1 first.");
        Assert.True(svc.TryGetProperty("topology", out var topo));
        Assert.True(topo.TryGetProperty("edges", out var edges));
        Assert.Equal(JsonValueKind.Array, edges.ValueKind);
        return edges;
    }

    private async Task<JsonElement> GetMatrixAsync(string? correlationAttribute)
    {
        var url = correlationAttribute is null
            ? "/api/deployments"
            : $"/api/deployments?correlationAttribute={Uri.EscapeDataString(correlationAttribute)}";
        var resp = await _read.GetAsync(url);
        Assert.True(resp.IsSuccessStatusCode,
            $"GET {url} returned {(int)resp.StatusCode}: {await resp.Content.ReadAsStringAsync()}");
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
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
        var dump = string.Join(", ", edgesArray.EnumerateArray().Select(e =>
            $"{e.GetProperty("from").GetString()}->{e.GetProperty("to").GetString()}/{e.GetProperty("source").GetString()}"));
        Assert.Fail(
            $"Expected edge {from} -> {to} (source={source}) not found. Actual edges: [{dump}]. " +
            "If the topology builder no longer derives correlated edges for ref/sha, that is the bug " +
            "this test exists to surface — fix the builder, not the assertion. " +
            "Per SAD §5 'Topology Derivation' pass 3 (correlation fallback).");
    }

    private static void AssertCurrentField(JsonElement matrix, string service, string env, string field, string expected)
    {
        Assert.True(matrix.TryGetProperty(service, out var svc),
            $"Matrix missing service '{service}' — seed.ps1 must be run before this suite.");
        Assert.True(svc.TryGetProperty("envs", out var envs));
        Assert.True(envs.TryGetProperty(env, out var slot),
            $"Service '{service}' has no slot for env '{env}'.");
        Assert.True(slot.TryGetProperty("current", out var current),
            $"{service}/{env}: 'current' missing.");
        Assert.True(current.TryGetProperty(field, out var value),
            $"{service}/{env}.current is missing '{field}' — was the fixture seeded with this field?");
        Assert.Equal(JsonValueKind.String, value.ValueKind);
        Assert.Equal(expected, value.GetString());
    }
}
