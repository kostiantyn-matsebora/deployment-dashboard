using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the FR-05 / SAD §10 Decision #10 additive cycle —
/// two optional nullable string fields on the ingest payload and the
/// read-side wire shape:
///
/// <list type="bullet">
///   <item><c>ref</c> — free-form branch / PR / tag identifier.</item>
///   <item><c>sha</c> — free-form commit hash.</item>
/// </list>
///
/// <para>Both fields are independent: a payload may carry neither, only
/// <c>ref</c>, only <c>sha</c>, both, or both set to explicit <c>null</c>.
/// The server MAY omit OR emit <c>null</c> on read responses when the
/// stored value is null — clients MUST treat absent and <c>null</c> as
/// equivalent (SAD §7 "Matrix response shape — per service" field rules).
/// </para>
///
/// <para><strong>No validation in this cycle.</strong> SAD §10 Decision
/// #10 explicitly defers length, format, and required-when-paired rules.
/// This suite therefore does NOT assert any rejection (400) for
/// <c>ref</c> / <c>sha</c> content. Length caps + hex checks land in a
/// later, separate validation overhaul.</para>
///
/// <para>Wire-shape oracle: every assertion is against the literal
/// JSON returned by the API (not the typed DTOs), so the test acts as
/// an independent contract check against the SAD rather than a
/// tautology that follows whichever shape the DTOs happen to have.</para>
///
/// <para>Citations: SAD §4 FR-05, §5 deployments table (lines 649-650),
/// §7 "POST /api/deployments request body" (lines 781-784), §7 "Matrix
/// response shape — per service" field rules (lines 886-892), §7 "SSE
/// slot-update data payload" (line 910), §10 Decision #10.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class RefShaFieldsTests : IDisposable
{
    private readonly HttpClient _authed;
    private readonly HttpClient _read;
    private readonly string _runScope;

    public RefShaFieldsTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _read = TestEnvironment.CreateReadClient();
        _runScope = Guid.NewGuid().ToString("N")[..12];
    }

    public void Dispose()
    {
        _authed.Dispose();
        _read.Dispose();
    }

    // ------------------------------------------------ 4 POST acceptance cases

    [Fact]
    public async Task Post_WithoutRefOrSha_Returns201_AndRoundTripsAsAbsentOrNull()
    {
        // The original seven-field shape — the backward-compatibility
        // baseline. Per SAD §7 backward-compat clause: payloads that
        // omit both fields MUST continue to be accepted.
        var (service, environment, deploymentId) = CoordsFor("neither");
        var body = $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{environment}}",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/neither",
              "run_number":    {{NextRunNumber()}},
              "actor":         "qa.bot"
            }
            """;

        await PostAndAssert201(body);
        await AssertSlotRoundTrip(service, environment, expectedRef: null, expectedSha: null);
        await AssertHistoryRoundTrip(service, environment, deploymentId, expectedRef: null, expectedSha: null);
    }

    [Fact]
    public async Task Post_WithRefOnly_Returns201_AndRefRoundTrips_ShaIsAbsentOrNull()
    {
        var (service, environment, deploymentId) = CoordsFor("ref-only");
        var body = $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{environment}}",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/ref-only",
              "run_number":    {{NextRunNumber()}},
              "actor":         "qa.bot",
              "ref":           "main"
            }
            """;

        await PostAndAssert201(body);
        await AssertSlotRoundTrip(service, environment, expectedRef: "main", expectedSha: null);
        await AssertHistoryRoundTrip(service, environment, deploymentId, expectedRef: "main", expectedSha: null);
    }

    [Fact]
    public async Task Post_WithShaOnly_Returns201_AndShaRoundTrips_RefIsAbsentOrNull()
    {
        var (service, environment, deploymentId) = CoordsFor("sha-only");
        var body = $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{environment}}",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/sha-only",
              "run_number":    {{NextRunNumber()}},
              "actor":         "qa.bot",
              "sha":           "9f1c0d2"
            }
            """;

        await PostAndAssert201(body);
        await AssertSlotRoundTrip(service, environment, expectedRef: null, expectedSha: "9f1c0d2");
        await AssertHistoryRoundTrip(service, environment, deploymentId, expectedRef: null, expectedSha: "9f1c0d2");
    }

    [Fact]
    public async Task Post_WithBoth_Returns201_AndBothRoundTrip()
    {
        var (service, environment, deploymentId) = CoordsFor("both");
        var body = $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{environment}}",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/both",
              "run_number":    {{NextRunNumber()}},
              "actor":         "qa.bot",
              "ref":           "feature/login-revamp",
              "sha":           "9f1c0d2e8a"
            }
            """;

        await PostAndAssert201(body);
        await AssertSlotRoundTrip(service, environment, expectedRef: "feature/login-revamp", expectedSha: "9f1c0d2e8a");
        await AssertHistoryRoundTrip(service, environment, deploymentId, expectedRef: "feature/login-revamp", expectedSha: "9f1c0d2e8a");
    }

    [Fact]
    public async Task Post_WithExplicitNullRefAndSha_Returns201_AndRoundTripsAsAbsentOrNull()
    {
        // Per SAD §7 "POST /api/deployments request body": "Omit the
        // property, send null, or send a string; absence and null are
        // equivalent." Explicit JSON null MUST be accepted and round-
        // trip identically to omission.
        var (service, environment, deploymentId) = CoordsFor("explicit-null");
        var body = $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{environment}}",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/explicit-null",
              "run_number":    {{NextRunNumber()}},
              "actor":         "qa.bot",
              "ref":           null,
              "sha":           null
            }
            """;

        await PostAndAssert201(body);
        await AssertSlotRoundTrip(service, environment, expectedRef: null, expectedSha: null);
        await AssertHistoryRoundTrip(service, environment, deploymentId, expectedRef: null, expectedSha: null);
    }

    // ------------------------------------------------ seeded-corpus assertion

    [Fact]
    public async Task GetMatrix_SeededCorpus_ExposesRefAndSha_PerFixtureContract()
    {
        // The canonical 6-box-state corpus carries ref / sha on a
        // representative subset of slots (see testing/fixtures/seed-data.json
        // _comment block). This test asserts the wire shape end-to-end:
        // POST -> store -> matrix render. It is the fixture-level
        // counterpart of the per-case POST round-trips above.
        var matrix = await GetMatrixAsJsonAsync();

        // service-b/dev (success): BOTH ref + sha populated.
        AssertCurrentRefSha(matrix, "service-b", "dev",
            expectedRef: "main", expectedSha: "9f1c0d2e8a");

        // service-a/dev (running-with-last-success): ref-only on current
        // AND on lastSuccessful (both events carry ref, neither carries sha).
        AssertCurrentRefSha(matrix, "service-a", "dev",
            expectedRef: "feature/login-revamp", expectedSha: null);
        AssertLastSuccessfulRefSha(matrix, "service-a", "dev",
            expectedRef: "main", expectedSha: null);

        // service-c/dev: current is in-progress (no ref/sha), but the
        // intermediate failure carried sha. The current/lastSuccessful
        // wire fields for this slot reflect THOSE specific events, not
        // the intermediate failure. The current carries neither.
        AssertCurrentRefSha(matrix, "service-c", "dev",
            expectedRef: null, expectedSha: null);

        // service-b/qa (failed-with-last-success): NEITHER event carries
        // ref or sha — legacy shape preserved. Both current AND
        // lastSuccessful must round-trip as absent-or-null.
        AssertCurrentRefSha(matrix, "service-b", "qa",
            expectedRef: null, expectedSha: null);
        AssertLastSuccessfulRefSha(matrix, "service-b", "qa",
            expectedRef: null, expectedSha: null);

        // service-d/dev (running-with-prev-failed): current carries ref
        // only ("hotfix/d-dev-1250"), no sha.
        AssertCurrentRefSha(matrix, "service-d", "dev",
            expectedRef: "hotfix/d-dev-1250", expectedSha: null);
    }

    // ------------------------------------------------ helpers

    private (string Service, string Environment, string DeploymentId) CoordsFor(string tag)
    {
        // Per-test unique service prevents cross-test interference and
        // makes the seed-corpus assertions independent. environment is
        // pinned to a sentinel value so qa-bot rows don't pollute the
        // mockup-fixture environment list.
        var service = $"qa-bot-fn-refsha-{tag}-{_runScope}";
        const string environment = "fn-refsha";
        var deploymentId = $"refsha-{tag}-{_runScope}";
        return (service, environment, deploymentId);
    }

    private async Task PostAndAssert201(string jsonBody)
    {
        using var content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync("/api/deployments", content);

        Assert.True(
            resp.StatusCode == HttpStatusCode.Created,
            $"Expected 201 Created for ref/sha POST; got {(int)resp.StatusCode}. " +
            $"Body: {await resp.Content.ReadAsStringAsync()}. " +
            "Per SAD §10 Decision #10 this cycle is ADDITIVE-ONLY — no validation, " +
            "every ref/sha content must be accepted.");
    }

    private async Task AssertSlotRoundTrip(string service, string environment, string? expectedRef, string? expectedSha)
    {
        var resp = await _read.GetAsync($"/api/deployments/{service}/{environment}");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.True(doc.RootElement.TryGetProperty("current", out var current),
            $"Slot {service}/{environment} response is missing 'current'.");

        AssertOmittedOrEquals(current, "ref", expectedRef, $"slot {service}/{environment}.current.ref");
        AssertOmittedOrEquals(current, "sha", expectedSha, $"slot {service}/{environment}.current.sha");
    }

    private async Task AssertHistoryRoundTrip(string service, string environment, string deploymentId, string? expectedRef, string? expectedSha)
    {
        var resp = await _read.GetAsync($"/api/deployments/{service}/{environment}/history");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        Assert.Equal(JsonValueKind.Array, doc.RootElement.ValueKind);

        JsonElement? match = null;
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            if (item.TryGetProperty("deployment_id", out var id) &&
                id.ValueKind == JsonValueKind.String &&
                id.GetString() == deploymentId)
            {
                match = item.Clone();
                break;
            }
        }
        Assert.True(match.HasValue,
            $"History for {service}/{environment} is missing deployment_id '{deploymentId}'. " +
            "Per SAD §7 'Matrix response shape' field rules every history item carries the full row fields.");

        AssertOmittedOrEquals(match!.Value, "ref", expectedRef, $"history[{deploymentId}].ref");
        AssertOmittedOrEquals(match!.Value, "sha", expectedSha, $"history[{deploymentId}].sha");
    }

    private async Task<JsonElement> GetMatrixAsJsonAsync()
    {
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var raw = await resp.Content.ReadAsStringAsync();
        // We must Clone() because the JsonDocument backing the element
        // would otherwise be disposed on `using` scope exit.
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static void AssertCurrentRefSha(JsonElement matrix, string service, string environment, string? expectedRef, string? expectedSha)
    {
        var current = GetSlotProperty(matrix, service, environment, "current");
        AssertOmittedOrEquals(current, "ref", expectedRef, $"matrix.{service}/{environment}.current.ref");
        AssertOmittedOrEquals(current, "sha", expectedSha, $"matrix.{service}/{environment}.current.sha");
    }

    private static void AssertLastSuccessfulRefSha(JsonElement matrix, string service, string environment, string? expectedRef, string? expectedSha)
    {
        var lastSuccessful = GetSlotProperty(matrix, service, environment, "lastSuccessful");
        // lastSuccessful may itself be a JSON null when no prior success
        // exists — the caller controls when to invoke this helper.
        Assert.NotEqual(JsonValueKind.Null, lastSuccessful.ValueKind);
        AssertOmittedOrEquals(lastSuccessful, "ref", expectedRef, $"matrix.{service}/{environment}.lastSuccessful.ref");
        AssertOmittedOrEquals(lastSuccessful, "sha", expectedSha, $"matrix.{service}/{environment}.lastSuccessful.sha");
    }

    private static JsonElement GetSlotProperty(JsonElement matrix, string service, string environment, string property)
    {
        Assert.True(matrix.TryGetProperty(service, out var svc),
            $"Matrix is missing service '{service}'. Run testing/scripts/seed.ps1 first.");
        Assert.True(svc.TryGetProperty("envs", out var envs),
            $"Service '{service}' is missing the 'envs' sibling (Phase 2 wire shape).");
        Assert.True(envs.TryGetProperty(environment, out var slot),
            $"Service '{service}' has no slot for environment '{environment}'.");
        Assert.True(slot.TryGetProperty(property, out var prop),
            $"Slot {service}/{environment} is missing '{property}'.");
        return prop;
    }

    /// <summary>
    /// Encodes the SAD §7 absence-or-null tolerance: when the expected
    /// value is null, the property may be omitted from the JSON entirely
    /// OR present with a JSON null. When the expected value is a string,
    /// the property MUST be present with that exact string value.
    /// </summary>
    private static void AssertOmittedOrEquals(JsonElement parent, string property, string? expected, string label)
    {
        var present = parent.TryGetProperty(property, out var prop);
        if (expected is null)
        {
            // Omitted entirely OR explicit null — both acceptable.
            if (!present) return;
            Assert.True(prop.ValueKind == JsonValueKind.Null,
                $"{label}: expected absent or JSON null, but property is present with kind '{prop.ValueKind}' (value '{prop}'). " +
                "Per SAD §7 field rules 'absent and null are equivalent' when no value is stored.");
            return;
        }
        Assert.True(present,
            $"{label}: expected string '{expected}' but the property is absent from the response. " +
            "Per SAD §7 field rules the property MUST be emitted when the stored value is non-null.");
        Assert.Equal(JsonValueKind.String, prop.ValueKind);
        Assert.Equal(expected, prop.GetString());
    }

    // Run number generator. Stays in a safe range that won't collide
    // with the seed corpus' run_number values (≤ 7203).
    private static long NextRunNumber()
    {
        return 800_000 + (DateTime.UtcNow.Ticks % 100_000);
    }
}
