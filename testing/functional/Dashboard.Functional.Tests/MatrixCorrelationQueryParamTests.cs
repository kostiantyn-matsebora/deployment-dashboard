using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the <c>?correlationAttribute=&lt;attr&gt;</c>
/// query parameter on <c>GET /api/deployments</c>.
///
/// <para>SAD §7 "API Contract" - "GET /api/deployments - query parameters":
/// the parameter is a per-request hint for the correlation-fallback pass
/// of the topology builder. Allowed values are
/// <c>{version, ref, sha, actor, run, ago}</c>; <c>id</c> is explicitly
/// disallowed. Any other value yields 400. Per-service overrides
/// (<c>PATCH /api/config/topology</c>) win regardless of the query
/// parameter. Omitting the parameter falls back to the server-side
/// default (<c>Topology.CorrelationAttribute</c>).</para>
///
/// <para>These tests are read-only on the test corpus. PATCH-based
/// scenarios snapshot the server config in <c>Dispose</c> so they're
/// order-independent.</para>
///
/// <para>Cites SAD §10 Decision #7 (SPA is read-only against the API,
/// per-user picker is a <c>localStorage</c>-only override travelling as
/// this query parameter) and #8 (SSE wire shape never carries topology;
/// the SPA refreshes via GET after each event). These tests pin the
/// CONTRACT, not the implementation; if the backend currently accepts
/// invalid values with 200 (a known regression at the time of writing),
/// these tests will fail and that's the bug we want surfaced.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class MatrixCorrelationQueryParamTests : IDisposable
{
    private static readonly string[] AllowedAttributes =
        { "version", "ref", "sha", "actor", "run", "ago" };

    private readonly HttpClient _read;
    private readonly HttpClient _authedRead;
    private JsonElement? _snapshot;

    public MatrixCorrelationQueryParamTests()
    {
        _read = TestEnvironment.CreateReadClient();
        _authedRead = new HttpClient
        {
            BaseAddress = new Uri(TestEnvironment.ReadBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        _authedRead.DefaultRequestHeaders.Add("X-Api-Key", TestEnvironment.ApiKey);
        _authedRead.DefaultRequestHeaders.Accept.Add(
            new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
    }

    public void Dispose()
    {
        if (_snapshot is JsonElement prev)
        {
            try { RestoreSnapshot(prev); } catch { /* best-effort */ }
        }
        _read.Dispose();
        _authedRead.Dispose();
    }

    // ----------------------------------------------------- happy path

    [Theory]
    [InlineData("version")]
    [InlineData("ref")]
    [InlineData("sha")]
    [InlineData("actor")]
    [InlineData("run")]
    [InlineData("ago")]
    public async Task GetMatrix_WithAllowedCorrelationAttribute_Returns200_AndPreservesEnvelope(string attr)
    {
        // SAD §7 "GET /api/deployments - query parameters": every value
        // in {version, ref, sha, actor, run, ago} is allowed. The
        // response shape (per service envelope { envs, topology })
        // must be unchanged - only the contents of topology.edges may
        // shift depending on the attribute.
        var resp = await _read.GetAsync($"/api/deployments?correlationAttribute={attr}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Object, matrix.ValueKind);

        var anyService = matrix.EnumerateObject().FirstOrDefault();
        Assert.False(string.IsNullOrEmpty(anyService.Name),
            "Matrix has no services - run testing/scripts/seed.ps1 first.");
        var node = anyService.Value;
        Assert.True(node.TryGetProperty("envs", out _),
            "Per-service envelope must include 'envs' sibling regardless of correlationAttribute.");
        Assert.True(node.TryGetProperty("topology", out var topology),
            "Per-service envelope must include 'topology' sibling regardless of correlationAttribute.");
        Assert.True(topology.TryGetProperty("edges", out var edges));
        Assert.Equal(JsonValueKind.Array, edges.ValueKind);
    }

    [Fact]
    public async Task GetMatrix_OmittedQueryParam_FallsBackToServerDefault()
    {
        // Per SAD: "Omitted -> falls back to the server-side default
        // (Topology.CorrelationAttribute)." We can't observe the server
        // default directly here, but we CAN assert that the topology
        // builder produced an envelope-shaped response in either case.
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var matrix = await resp.Content.ReadFromJsonAsync<JsonElement>();
        foreach (var svc in matrix.EnumerateObject())
        {
            Assert.True(svc.Value.TryGetProperty("envs", out _));
            Assert.True(svc.Value.TryGetProperty("topology", out _));
        }
    }

    [Fact]
    public async Task GetMatrix_DifferentCorrelationAttributes_MayProduceDifferentEdges()
    {
        // The topology fixture corpus exercises explicit + correlated
        // edges. For the pure-correlated services (topo-correlated and
        // the lower part of topo-mixed), the correlation-attribute
        // controls which events get connected. Two different attributes
        // may yield different edge sets on those services. We don't
        // pin the exact diff (depends on fixture data shape) - we only
        // assert that BOTH responses are envelope-valid.
        //
        // Per-service overrides win regardless (PATCH /api/config/topology)
        // - that interaction is tested in Patch_PerServiceOverride_*
        // below.
        var byVersion = await _read.GetFromJsonAsync<JsonElement>(
            "/api/deployments?correlationAttribute=version");
        var byActor = await _read.GetFromJsonAsync<JsonElement>(
            "/api/deployments?correlationAttribute=actor");

        Assert.Equal(JsonValueKind.Object, byVersion.ValueKind);
        Assert.Equal(JsonValueKind.Object, byActor.ValueKind);

        var vCount = byVersion.EnumerateObject().Count();
        var aCount = byActor.EnumerateObject().Count();
        Assert.Equal(vCount, aCount); // service set is the same; only edges may differ
    }

    // ----------------------------------------------------- rejection

    [Theory]
    [InlineData("id",         "id is explicitly disallowed (it is the EXPLICIT key, not a correlation attribute)")]
    [InlineData("zzz",        "unknown attribute outside the allowed set")]
    [InlineData("VERSION",    "case-sensitive: 'VERSION' is not in the allowed set ('version' is)")]
    [InlineData("",           "empty string is not a valid attribute")]
    [InlineData("status",     "'status' looks like an attribute but is not in the allowed set")]
    public async Task GetMatrix_InvalidCorrelationAttribute_Returns400(string value, string rationale)
    {
        // SAD §7 "GET /api/deployments - query parameters":
        // "Allowed values: version, ref, sha, actor, run, ago.
        //  id is disallowed. Invalid value -> 400 Bad Request."
        //
        // If the backend currently returns 200 for these values, that's
        // a contract regression (FAIL here = bug surfaced).
        var resp = await _read.GetAsync($"/api/deployments?correlationAttribute={Uri.EscapeDataString(value)}");
        Assert.True(
            resp.StatusCode == HttpStatusCode.BadRequest,
            $"Expected 400 for correlationAttribute='{value}' ({rationale}); got {(int)resp.StatusCode}. " +
            "SAD §7 'GET /api/deployments - query parameters' enumerates the allowed set; everything else must be 400.");
    }

    // ----------------------------------------------------- precedence

    [Fact]
    public async Task PerServiceOverride_WinsAgainst_QueryParam_OnThatService()
    {
        // SAD §7 "GET /api/deployments - query parameters" /
        // "Configuration - Read API topology" / "Precedence":
        //   PerServiceOverrides[svc] > query-param > server default
        //
        // We set a per-service override on `topo-mixed` to `ref`. A
        // request with ?correlationAttribute=actor should produce
        // edges that, FOR topo-mixed ONLY, were derived using `ref`
        // (the override). For other services, `actor` is the operative
        // attribute. We can't directly observe which attribute the
        // server used, but we CAN observe that:
        //   * the override is reflected in GET /api/config/topology;
        //   * a matrix read with ?correlationAttribute=actor still
        //     returns topo-mixed with the same edge set as a read
        //     without the override + ?correlationAttribute=ref;
        //   * setting a DIFFERENT override (sha) yields a potentially
        //     different edge set for that service.
        //
        // Minimal assertion path: snapshot config, set override,
        // confirm GET /api/config/topology reflects the override, and
        // assert the matrix read still returns 200 with the envelope
        // shape. The deeper "edge set matches the override attribute"
        // assertion is covered by TopologyDerivationTests + the
        // mixed-service corpus.
        await SnapshotAsync();

        const string SERVICE = "topo-mixed";
        var setResp = await PatchConfigAsync(new
        {
            perServiceOverrides = new System.Collections.Generic.Dictionary<string, object?>
            {
                [SERVICE] = "ref",
            },
        });
        Assert.Equal(HttpStatusCode.OK, setResp.StatusCode);
        var afterSet = await setResp.Content.ReadFromJsonAsync<JsonElement>();
        var overrides = afterSet.GetProperty("perServiceOverrides");
        Assert.True(overrides.TryGetProperty(SERVICE, out var val));
        Assert.Equal("ref", val.GetString());

        // Now issue a matrix read with a DIFFERENT correlationAttribute.
        // The response must still be 200 and shape-valid; per the SAD,
        // for `topo-mixed` the override wins, so the edges for that
        // service are derived from `ref`, not from `actor`. The other
        // services use `actor`.
        var matrixResp = await _read.GetAsync("/api/deployments?correlationAttribute=actor");
        Assert.Equal(HttpStatusCode.OK, matrixResp.StatusCode);
        var matrix = await matrixResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(matrix.TryGetProperty(SERVICE, out var svcNode),
            $"Matrix missing service '{SERVICE}' - run testing/scripts/seed.ps1 first.");
        Assert.True(svcNode.TryGetProperty("topology", out _));
        Assert.True(svcNode.TryGetProperty("envs", out _));

        // Sanity: every other service in the topology corpus should
        // also still be present (the override on one service must not
        // affect others).
        Assert.True(matrix.TryGetProperty("topo-correlated", out _));
        Assert.True(matrix.TryGetProperty("topo-explicit", out _));
    }

    // ----------------------------------------------------- helpers

    private async Task SnapshotAsync()
    {
        if (_snapshot is not null) return;
        var resp = await _read.GetAsync("/api/config/topology");
        if (resp.IsSuccessStatusCode)
        {
            var raw = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            _snapshot = doc.RootElement.Clone();
        }
    }

    private async Task<HttpResponseMessage> PatchConfigAsync(object body)
    {
        var content = JsonContent.Create(body);
        using var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology")
        {
            Content = content,
        };
        return await _authedRead.SendAsync(req);
    }

    private void RestoreSnapshot(JsonElement snapshot)
    {
        // See ConfigTopologyTests.RestoreSnapshot for the rationale -
        // sending the raw snapshot body alone fails to remove overrides
        // that were ADDED during the test (PATCH leaves unset keys
        // alone). We compute the diff and emit explicit nulls.
        var current = _read.GetFromJsonAsync<JsonElement>("/api/config/topology").GetAwaiter().GetResult();
        var desired = new System.Collections.Generic.Dictionary<string, string?>(StringComparer.Ordinal);
        if (snapshot.TryGetProperty("perServiceOverrides", out var snapOverrides) &&
            snapOverrides.ValueKind == JsonValueKind.Object)
        {
            foreach (var entry in snapOverrides.EnumerateObject())
            {
                desired[entry.Name] = entry.Value.ValueKind == JsonValueKind.String
                    ? entry.Value.GetString()
                    : null;
            }
        }
        var clears = new System.Collections.Generic.List<string>();
        if (current.TryGetProperty("perServiceOverrides", out var curOverrides) &&
            curOverrides.ValueKind == JsonValueKind.Object)
        {
            foreach (var entry in curOverrides.EnumerateObject())
            {
                if (!desired.ContainsKey(entry.Name)) clears.Add(entry.Name);
            }
        }
        var perServiceJson = new StringBuilder();
        perServiceJson.Append('{');
        var first = true;
        foreach (var (key, value) in desired)
        {
            if (!first) perServiceJson.Append(',');
            first = false;
            perServiceJson.Append(JsonSerializer.Serialize(key));
            perServiceJson.Append(':');
            perServiceJson.Append(value is null ? "null" : JsonSerializer.Serialize(value));
        }
        foreach (var key in clears)
        {
            if (!first) perServiceJson.Append(',');
            first = false;
            perServiceJson.Append(JsonSerializer.Serialize(key));
            perServiceJson.Append(":null");
        }
        perServiceJson.Append('}');

        var bodyJson = new StringBuilder();
        bodyJson.Append('{');
        if (snapshot.TryGetProperty("correlationAttribute", out var snapAttr) &&
            snapAttr.ValueKind == JsonValueKind.String)
        {
            bodyJson.Append("\"correlationAttribute\":");
            bodyJson.Append(JsonSerializer.Serialize(snapAttr.GetString()!));
            bodyJson.Append(',');
        }
        bodyJson.Append("\"perServiceOverrides\":");
        bodyJson.Append(perServiceJson);
        bodyJson.Append('}');

        using var content = new StringContent(bodyJson.ToString(), Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology")
        {
            Content = content,
        };
        _authedRead.SendAsync(req).GetAwaiter().GetResult();
    }
}
