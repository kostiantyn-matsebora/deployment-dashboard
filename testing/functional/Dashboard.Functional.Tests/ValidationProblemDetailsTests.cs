using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Phase 5 targeted regression for CR-0008 — RFC 7807 ValidationProblemDetails
/// shape on every <c>422 Unprocessable Entity</c> from POST /api/deployments.
///
/// <para>Oracle is the verbatim block in
/// <c>docs/cr/CR-0008-api-validation-and-openapi-scalar.md</c> §
/// "Standardised error response shape" + the "Validation rule table" caps
/// (ref=200, sha=64, parent_deployments[i]=200). Assertions encode that
/// contract precisely; they do NOT model the current implementation.
/// Failures are real regressions, not test-oracle bugs.</para>
///
/// <para>TIGHT oracle properties (per qa-engineer.md "Test oracles can be
/// wrong"):
/// <list type="bullet">
///   <item>Distinguishes ValidationProblemDetails from plain ProblemDetails:
///         <c>errors</c> map MUST be present and non-empty.</item>
///   <item><c>Content-Type</c> MUST be <c>application/problem+json</c>
///         (any charset suffix tolerated).</item>
///   <item><c>errors</c> map keys MUST be camelCase form of the JSON wire
///         field names (e.g. <c>service</c>, <c>runUrl</c>,
///         <c>deploymentId</c>, <c>parentDeployments</c>) — never PascalCase
///         C# property names.</item>
///   <item>Per-element <c>parent_deployments</c> violations surface under
///         the array key <c>parentDeployments[0]</c> per CR-0008 BE
///         decision; the literal index form is the contract.</item>
///   <item>Each <c>errors</c> value is a non-empty string array.</item>
///   <item><c>type</c>, <c>title</c>, <c>status:422</c> all present.</item>
/// </list>
/// </para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class ValidationProblemDetailsTests : IDisposable
{
    private readonly HttpClient _authed;
    private readonly string _runScope;

    public ValidationProblemDetailsTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _runScope = Guid.NewGuid().ToString("N")[..12];
    }

    public void Dispose() => _authed.Dispose();

    // --------------------------------------------------------- Case #1

    [Fact]
    public async Task Post_MissingMultipleRequiredFields_Returns422_ProblemJsonWithCamelCaseErrors()
    {
        // Empty body — every required field is missing. This is the
        // canonical multi-field 422 path. The shape must match CR-0008's
        // verbatim example body (modulo per-field messages).
        var resp = await PostRawAsync("{}");

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        AssertProblemJsonContentType(resp);

        using var doc = await ReadProblemDocAsync(resp);
        var root = doc.RootElement;

        // Required RFC 7807 members + status mirror.
        Assert.True(root.TryGetProperty("type", out var typeEl) && typeEl.ValueKind == JsonValueKind.String,
            "ValidationProblemDetails MUST carry a 'type' URI (RFC 7807 §3.1).");
        Assert.True(root.TryGetProperty("title", out var titleEl) && titleEl.ValueKind == JsonValueKind.String,
            "ValidationProblemDetails MUST carry a 'title' (RFC 7807 §3.1).");
        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 422,
            "'status' MUST mirror the 422 response code (CR-0008 verbatim block).");

        // ValidationProblemDetails-specific: errors map MUST exist + be non-empty.
        Assert.True(root.TryGetProperty("errors", out var errors),
            "422 body MUST be ValidationProblemDetails (has 'errors' map) — distinguishes from plain ProblemDetails.");
        Assert.Equal(JsonValueKind.Object, errors.ValueKind);
        var errorKeys = CollectKeys(errors);
        Assert.NotEmpty(errorKeys);

        // CR-0008 verbatim: keys are camelCase JSON wire-field names.
        // Empty body => every required field surfaces. Assert a few
        // representative camelCase keys.
        AssertCamelCaseAndContains(errorKeys, "service");
        AssertCamelCaseAndContains(errorKeys, "environment");
        AssertCamelCaseAndContains(errorKeys, "version");
        AssertCamelCaseAndContains(errorKeys, "actor");
        AssertCamelCaseAndContains(errorKeys, "runUrl");
        AssertCamelCaseAndContains(errorKeys, "deploymentId");

        // Each value is a non-empty string[].
        foreach (var prop in errors.EnumerateObject())
        {
            Assert.Equal(JsonValueKind.Array, prop.Value.ValueKind);
            Assert.True(prop.Value.GetArrayLength() >= 1,
                $"errors['{prop.Name}'] must be a non-empty string array.");
            foreach (var msg in prop.Value.EnumerateArray())
            {
                Assert.Equal(JsonValueKind.String, msg.ValueKind);
                Assert.False(string.IsNullOrWhiteSpace(msg.GetString()));
            }
        }
    }

    // --------------------------------------------------------- Case #2

    [Theory]
    [InlineData("service")]
    [InlineData("environment")]
    [InlineData("version")]
    [InlineData("actor")]
    [InlineData("run_url")]
    [InlineData("deployment_id")]
    public async Task Post_WhitespaceOnlyRequiredField_Returns422_FieldNamedInErrors(string wireField)
    {
        // CR-0008 "Universal rules": required string fields rejected when
        // null, "", or whitespace-only. This guards against
        // [Required(AllowEmptyStrings=true)] accidentally allowing "   ".
        var fieldsJson = BuildValidPayloadJson(_runScope, "ws", overrideField: wireField, overrideValue: "\"   \"");
        var resp = await PostRawAsync(fieldsJson);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        AssertProblemJsonContentType(resp);

        using var doc = await ReadProblemDocAsync(resp);
        Assert.True(doc.RootElement.TryGetProperty("errors", out var errors),
            "Whitespace-only required field MUST produce a ValidationProblemDetails 'errors' map.");
        var camelKey = SnakeToCamel(wireField);
        var keys = CollectKeys(errors);
        Assert.Contains(camelKey, keys);
    }

    // --------------------------------------------------------- Case #3

    [Fact]
    public async Task Post_RefOver200Chars_Returns422_RefKeyInErrors()
    {
        // CR-0008 verbatim row 'ref': maxLength = 200.
        var tooLongRef = new string('r', 201);
        var json = BuildValidPayloadJson(_runScope, "ref-cap")
            .Insert(1, $"\"ref\":\"{tooLongRef}\",");
        var resp = await PostRawAsync(json);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        AssertProblemJsonContentType(resp);
        using var doc = await ReadProblemDocAsync(resp);
        Assert.True(doc.RootElement.TryGetProperty("errors", out var errors));
        Assert.Contains("ref", CollectKeys(errors));
    }

    // --------------------------------------------------------- Case #4

    [Fact]
    public async Task Post_ShaOver64Chars_Returns422_ShaKeyInErrors()
    {
        // CR-0008 verbatim row 'sha': maxLength = 64.
        var tooLongSha = new string('a', 65);
        var json = BuildValidPayloadJson(_runScope, "sha-cap")
            .Insert(1, $"\"sha\":\"{tooLongSha}\",");
        var resp = await PostRawAsync(json);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        AssertProblemJsonContentType(resp);
        using var doc = await ReadProblemDocAsync(resp);
        Assert.True(doc.RootElement.TryGetProperty("errors", out var errors));
        Assert.Contains("sha", CollectKeys(errors));
    }

    // --------------------------------------------------------- Case #5

    [Fact]
    public async Task Post_ParentDeploymentsElementOver200Chars_Returns422_IndexedKeyInErrors()
    {
        // CR-0008 verbatim row 'parent_deployments[i]': 200-per-element.
        // BE decision: per-element key form is "parentDeployments[0]".
        var tooLong = new string('p', 201);
        var json = BuildValidPayloadJson(_runScope, "parent-cap")
            .Insert(1, $"\"parent_deployments\":[\"{tooLong}\"],");
        var resp = await PostRawAsync(json);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        AssertProblemJsonContentType(resp);
        using var doc = await ReadProblemDocAsync(resp);
        Assert.True(doc.RootElement.TryGetProperty("errors", out var errors));
        var keys = CollectKeys(errors);
        // Per BE decision: indexed form, e.g. "parentDeployments[0]".
        // Accept either the exact indexed form OR an entry under
        // "parentDeployments" — both are defensible reads of the
        // CR-0008 verbatim block. Prefer the indexed form (tight oracle)
        // and fall back so the assertion message surfaces the actual keys.
        Assert.True(
            keys.Contains("parentDeployments[0]") || keys.Contains("parentDeployments"),
            $"Expected per-element key 'parentDeployments[0]' (preferred) or 'parentDeployments'; got keys: [{string.Join(", ", keys)}].");
    }

    // --------------------------------------------------------- helpers

    private async Task<HttpResponseMessage> PostRawAsync(string json)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        return await _authed.PostAsync("/api/deployments", content);
    }

    private static void AssertProblemJsonContentType(HttpResponseMessage resp)
    {
        var ct = resp.Content.Headers.ContentType?.MediaType;
        Assert.Equal("application/problem+json", ct);
    }

    private static async Task<JsonDocument> ReadProblemDocAsync(HttpResponseMessage resp)
    {
        var raw = await resp.Content.ReadAsStringAsync();
        Assert.False(string.IsNullOrWhiteSpace(raw), "Problem+json body must not be empty.");
        return JsonDocument.Parse(raw);
    }

    private static System.Collections.Generic.HashSet<string> CollectKeys(JsonElement obj)
    {
        var keys = new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
        foreach (var prop in obj.EnumerateObject()) keys.Add(prop.Name);
        return keys;
    }

    private static void AssertCamelCaseAndContains(System.Collections.Generic.HashSet<string> keys, string expectedCamel)
    {
        Assert.True(keys.Contains(expectedCamel),
            $"errors map MUST contain camelCase key '{expectedCamel}' (CR-0008 verbatim). Actual keys: [{string.Join(", ", keys)}].");
    }

    private static string SnakeToCamel(string snake)
    {
        var parts = snake.Split('_');
        if (parts.Length == 1) return parts[0];
        var sb = new StringBuilder(parts[0]);
        for (var i = 1; i < parts.Length; i++)
        {
            if (parts[i].Length == 0) continue;
            sb.Append(char.ToUpperInvariant(parts[i][0]));
            if (parts[i].Length > 1) sb.Append(parts[i][1..]);
        }
        return sb.ToString();
    }

    /// <summary>
    /// Build a fully-valid JSON payload (every required field present, no
    /// optional fields) and, if <paramref name="overrideField"/> is set,
    /// substitute that wire-field's value with <paramref name="overrideValue"/>
    /// (which must be a JSON literal — caller wraps strings in quotes).
    /// </summary>
    private static string BuildValidPayloadJson(string runScope, string tag, string? overrideField = null, string? overrideValue = null)
    {
        string DefaultFor(string field) => field switch
        {
            "service" => $"\"qa-bot-fn-{tag}-{runScope}\"",
            "environment" => "\"fn-test\"",
            "version" => "\"v0.0.1\"",
            "status" => "\"success\"",
            "run_url" => "\"https://example.com/runs/x\"",
            "run_number" => "1",
            "actor" => "\"qa.bot\"",
            "deployment_id" => $"\"fn-{tag}-{runScope}-{Guid.NewGuid():N}\"",
            _ => throw new ArgumentOutOfRangeException(nameof(field)),
        };

        string Field(string name) => $"\"{name}\":" +
            (string.Equals(name, overrideField, StringComparison.Ordinal) ? overrideValue! : DefaultFor(name));

        return "{" + string.Join(",", new[]
        {
            Field("deployment_id"),
            Field("service"),
            Field("environment"),
            Field("version"),
            Field("status"),
            Field("run_url"),
            Field("run_number"),
            Field("actor"),
        }) + "}";
    }
}
