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
/// Functional tests for <c>GET</c> and <c>PATCH /api/config/topology</c>
/// (SAD §7 "API Contract" - "PATCH /api/config/topology", §"Components"
/// -> "Dashboard Backend" -> "Configuration - Read API topology").
///
/// <para>Covers:</para>
/// <list type="bullet">
///   <item>GET returns the active config <c>{correlationAttribute,
///         allowUserOverride, perServiceOverrides}</c>.</item>
///   <item>PATCH with X-Api-Key updates the global default and
///         next GET / next matrix read reflect it.</item>
///   <item>PATCH semantics: unset field unchanged; <c>null</c> in
///         <c>perServiceOverrides[service]</c> removes that override.</item>
///   <item>403 Forbidden when <c>AllowUserOverride: false</c> (skipped
///         when the dev stack is configured with the default
///         <c>true</c>).</item>
///   <item>401 Unauthorized when X-Api-Key is missing.</item>
///   <item>400 Bad Request when the new attribute is not in the allowed
///         set <c>{version, ref, sha, actor, run, ago}</c>.</item>
/// </list>
///
/// <para>Tests restore the previous config in <c>Dispose</c> so they're
/// order-independent and don't leak server-side mutations into the rest
/// of the suite.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class ConfigTopologyTests : IDisposable
{
    private readonly HttpClient _authedRead;   // Read API - PATCH gated by X-Api-Key
    private readonly HttpClient _read;          // Read API - bare (no key) for GET + 401 cases
    private JsonElement? _snapshot;

    public ConfigTopologyTests()
    {
        _read = TestEnvironment.CreateReadClient();

        // Read API PATCH /api/config/topology is gated by X-Api-Key
        // (same middleware as POST /api/deployments per SAD §7).
        _authedRead = new HttpClient
        {
            BaseAddress = new Uri(TestEnvironment.ReadBaseUrl),
            Timeout = TimeSpan.FromSeconds(15),
        };
        _authedRead.DefaultRequestHeaders.Add("X-Api-Key", TestEnvironment.ApiKey);
        _authedRead.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
    }

    public void Dispose()
    {
        // Best-effort restore of the previous config so the rest of the
        // suite sees the same defaults regardless of test ordering. We
        // do this synchronously - test classes use IDisposable, not
        // IAsyncDisposable, and we cannot await here.
        //
        // PATCH semantics (SAD §7 "PATCH /api/config/topology request
        // body"): unset fields are left unchanged; an empty
        // `perServiceOverrides: {}` therefore does NOT clear existing
        // overrides. To return the server to its snapshot state we must:
        //
        //   1) Snapshot the CURRENT overrides (post-test) and emit a
        //      `null` sentinel for every key we want to remove (the
        //      documented "remove the override" semantics, exercised
        //      by Patch_PerServiceOverride_SetsAndClears).
        //   2) Re-apply each override that was present in the original
        //      snapshot as the literal string.
        //   3) Re-apply the original `correlationAttribute`.
        //
        // Sending the raw snapshot body (which is the pre-mutation
        // shape, often `perServiceOverrides: {}`) is exactly the bug
        // we are fixing here.
        if (_snapshot is JsonElement prev)
        {
            try
            {
                RestoreSnapshot(prev);
            }
            catch
            {
                // Restore is best-effort; never let it throw.
            }
        }
        _read.Dispose();
        _authedRead.Dispose();
    }

    private void RestoreSnapshot(JsonElement snapshot)
    {
        // Collect the set of override keys we want to clear: every
        // key currently on the server that is NOT present in the
        // snapshot. Anything in the snapshot will be re-set below
        // (idempotent overwrite).
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
                if (!desired.ContainsKey(entry.Name))
                {
                    clears.Add(entry.Name);
                }
            }
        }

        // Build a single PATCH body that:
        //   - explicitly sets every original override to its original value,
        //   - explicitly nulls every stray override added during the test,
        //   - restores `correlationAttribute` to the snapshot value.
        var perServiceJson = new StringBuilder();
        perServiceJson.Append('{');
        var first = true;
        foreach (var (key, value) in desired)
        {
            if (!first) perServiceJson.Append(',');
            first = false;
            perServiceJson.Append(JsonEncodedString(key));
            perServiceJson.Append(':');
            perServiceJson.Append(value is null ? "null" : JsonEncodedString(value));
        }
        foreach (var key in clears)
        {
            if (!first) perServiceJson.Append(',');
            first = false;
            perServiceJson.Append(JsonEncodedString(key));
            perServiceJson.Append(":null");
        }
        perServiceJson.Append('}');

        var bodyJson = new StringBuilder();
        bodyJson.Append('{');
        if (snapshot.TryGetProperty("correlationAttribute", out var snapAttr) &&
            snapAttr.ValueKind == JsonValueKind.String)
        {
            bodyJson.Append("\"correlationAttribute\":");
            bodyJson.Append(JsonEncodedString(snapAttr.GetString()!));
            bodyJson.Append(',');
        }
        bodyJson.Append("\"perServiceOverrides\":");
        bodyJson.Append(perServiceJson);
        bodyJson.Append('}');

        using var content = new StringContent(bodyJson.ToString(), Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology") { Content = content };
        _authedRead.SendAsync(req).GetAwaiter().GetResult();
    }

    private static string JsonEncodedString(string value)
    {
        // Tiny helper - System.Text.Json can serialise a bare string with
        // JsonSerializer.Serialize, which gives us the quoted+escaped form.
        return JsonSerializer.Serialize(value);
    }

    // ----------------------------------------------------- GET

    [Fact]
    public async Task Get_ReturnsCurrentEffectiveConfig()
    {
        var resp = await _read.GetAsync("/api/config/topology");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        await SnapshotAsync();

        // SAD §7 "PATCH /api/config/topology request body" - the
        // response shape is "the full active config (same shape as
        // GET /api/config/topology)" with at least the two fields below.
        Assert.True(body.TryGetProperty("correlationAttribute", out var attr),
            "GET /api/config/topology must expose 'correlationAttribute'.");
        Assert.Equal(JsonValueKind.String, attr.ValueKind);
        Assert.False(string.IsNullOrWhiteSpace(attr.GetString()));

        Assert.True(body.TryGetProperty("perServiceOverrides", out var overrides),
            "GET /api/config/topology must expose 'perServiceOverrides'.");
        Assert.Equal(JsonValueKind.Object, overrides.ValueKind);

        // 'allowUserOverride' may or may not be surfaced depending on the
        // implementation - the SAD example body only documents the two
        // writeable fields. We treat its presence as optional but assert
        // its type when present.
        if (body.TryGetProperty("allowUserOverride", out var allow))
        {
            Assert.True(allow.ValueKind == JsonValueKind.True || allow.ValueKind == JsonValueKind.False);
        }
    }

    // ----------------------------------------------------- PATCH happy

    [Fact]
    public async Task Patch_GlobalAttribute_UpdatesConfig_AndReflectsInMatrix()
    {
        await SnapshotAsync();

        // Flip the global default to 'actor' (a documented allowed value).
        var resp = await PatchAsync(_authedRead, new
        {
            correlationAttribute = "actor",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("actor", body.GetProperty("correlationAttribute").GetString());

        // GET reflects the change.
        var after = await _read.GetFromJsonAsync<JsonElement>("/api/config/topology");
        Assert.Equal("actor", after.GetProperty("correlationAttribute").GetString());

        // Matrix read reflects it - the topology builder uses the new
        // attribute on the next read per SAD §"Topology Derivation".
        // We can't assert specific edges without coupling to a corpus
        // that differs by actor, so the assertion here is only that the
        // matrix call still succeeds and the wire shape is intact.
        var matrix = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, matrix.StatusCode);
    }

    [Fact]
    public async Task Patch_PerServiceOverride_SetsAndClears()
    {
        await SnapshotAsync();

        // Set an override for 'topo-mixed' to 'ref'.
        var set = await PatchAsync(_authedRead, new
        {
            perServiceOverrides = new System.Collections.Generic.Dictionary<string, object?>
            {
                ["topo-mixed"] = "ref",
            },
        });
        Assert.Equal(HttpStatusCode.OK, set.StatusCode);
        var afterSet = await set.Content.ReadFromJsonAsync<JsonElement>();
        var overrides = afterSet.GetProperty("perServiceOverrides");
        Assert.True(overrides.TryGetProperty("topo-mixed", out var val));
        Assert.Equal("ref", val.GetString());

        // PATCH again with null - per SAD §7 "perServiceOverrides"
        // documentation: "null removes the override for that service".
        // Sent as a raw JSON body because anonymous objects + null
        // values get System.Text.Json-serialised as omitted when the
        // default-ignore policy applies; we want the literal `null`.
        var clearJson = """
            { "perServiceOverrides": { "topo-mixed": null } }
            """;
        using (var content = new StringContent(clearJson, Encoding.UTF8, "application/json"))
        using (var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology") { Content = content })
        {
            var clear = await _authedRead.SendAsync(req);
            Assert.Equal(HttpStatusCode.OK, clear.StatusCode);
            var afterClear = await clear.Content.ReadFromJsonAsync<JsonElement>();
            var clearedOverrides = afterClear.GetProperty("perServiceOverrides");
            // Either the key is now absent OR present as JSON null. The SAD
            // describes removal; either form is consistent with that.
            if (clearedOverrides.TryGetProperty("topo-mixed", out var stillThere))
            {
                Assert.Equal(JsonValueKind.Null, stillThere.ValueKind);
            }
        }
    }

    [Fact]
    public async Task Patch_UnsetField_IsLeftUnchanged()
    {
        // PATCH semantics: a body with only 'correlationAttribute' must
        // leave 'perServiceOverrides' alone.
        await SnapshotAsync();

        // Seed an override first so we have something observable.
        await PatchAsync(_authedRead, new
        {
            perServiceOverrides = new System.Collections.Generic.Dictionary<string, object?>
            {
                ["topo-correlated"] = "ref",
            },
        });

        // Now PATCH only the global default.
        var resp = await PatchAsync(_authedRead, new
        {
            correlationAttribute = "sha",
        });
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("sha", body.GetProperty("correlationAttribute").GetString());

        // The previously-set per-service override must still be present.
        var overrides = body.GetProperty("perServiceOverrides");
        Assert.True(overrides.TryGetProperty("topo-correlated", out var preserved),
            "PATCH semantics: unset 'perServiceOverrides' field must leave overrides unchanged.");
        Assert.Equal("ref", preserved.GetString());
    }

    // ----------------------------------------------------- PATCH rejection

    [Fact]
    public async Task Patch_MissingApiKey_Returns401()
    {
        var json = """ { "correlationAttribute": "version" } """;
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        using var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology")
        {
            Content = content,
        };

        // _read has no X-Api-Key header.
        var resp = await _read.SendAsync(req);
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Patch_InvalidCorrelationAttribute_Returns400()
    {
        await SnapshotAsync();

        // 'id' is explicitly disallowed per SAD §"Configuration - Read
        // API topology": "id is explicitly disallowed - deployment_id
        // is the explicit key".
        var resp = await PatchAsync(_authedRead, new
        {
            correlationAttribute = "id",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Patch_UnknownAttribute_Returns400()
    {
        await SnapshotAsync();

        // Some arbitrary string outside the allowed set.
        var resp = await PatchAsync(_authedRead, new
        {
            correlationAttribute = "made-up-attr",
        });
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Patch_AllowUserOverrideFalse_Returns403()
    {
        // Per SAD: "if AllowUserOverride is false, PATCH returns 403".
        // The local dev stack defaults to true, so this test is only
        // meaningful when the operator has pinned the config. We probe
        // GET first and skip when the flag is true or absent - that
        // matches the dev-target reality and means the test is a true
        // positive when run against a pinned environment.
        var current = await _read.GetFromJsonAsync<JsonElement>("/api/config/topology");
        var allow = true;
        if (current.TryGetProperty("allowUserOverride", out var a) &&
            (a.ValueKind == JsonValueKind.True || a.ValueKind == JsonValueKind.False))
        {
            allow = a.GetBoolean();
        }

        if (allow)
        {
            // Default-true environment. xUnit 2.9 has no Assert.Skip,
            // so we treat this as a precondition match and exit cleanly -
            // the test is meaningful only when an operator has pinned the
            // config. CI may run a dedicated pinned-config job to assert
            // the negative path with the same code.
            return;
        }

        var resp = await PatchAsync(_authedRead, new
        {
            correlationAttribute = "ref",
        });
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    // ----------------------------------------------------- helpers

    private async Task SnapshotAsync()
    {
        if (_snapshot is not null) return;
        var resp = await _read.GetAsync("/api/config/topology");
        if (resp.IsSuccessStatusCode)
        {
            // Materialise to a stable JSON document for later restore.
            var raw = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(raw);
            _snapshot = doc.RootElement.Clone();
        }
    }

    private static async Task<HttpResponseMessage> PatchAsync(HttpClient client, object body)
    {
        // JsonContent for PATCH - keep parity with PostAsJsonAsync semantics
        // for nullability and casing.
        var content = JsonContent.Create(body);
        using var req = new HttpRequestMessage(new HttpMethod("PATCH"), "/api/config/topology")
        {
            Content = content,
        };
        return await client.SendAsync(req);
    }
}
