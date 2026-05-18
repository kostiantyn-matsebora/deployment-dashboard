using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Dashboard.ReadApi.Tests;

/// <summary>
/// CR-0009 § OpenAPI surface — the universal <c>X-Progress-Reporter</c> header
/// and the new <c>GET</c>/<c>PUT /api/fetcher/state/{source-id}</c> endpoints
/// must appear correctly in the generated OpenAPI document.
///
/// <para>BE shipped the wire surface in Wave 2 + co-located happy-path tests;
/// this file is QA's snapshot test that locks the OpenAPI exposure of those
/// endpoints + the header parameter so a future regression on the
/// <c>[FromHeader]</c> binding or the route registration fails loudly.</para>
///
/// <para>The header's <c>maxLength: 64</c> + <c>required: true</c> on the two
/// state endpoints are injected post-generation by
/// <c>ProgressReporterHeaderOperationTransformer</c> — DataAnnotations don't
/// fire on <c>[FromHeader]</c> string bindings, so the transformer is the
/// canonical place to enforce the OpenAPI shape (the runtime validator
/// remains authoritative, see <c>WriteApiEndpoints.TryValidateProgressReporterHeader</c>).</para>
/// </summary>
public sealed class OpenApiProgressReporterHeaderTests : IClassFixture<TestApplicationFactory>
{
    private readonly HttpClient _client;

    public OpenApiProgressReporterHeaderTests(TestApplicationFactory factory)
    {
        _client = factory.CreateClient();
    }

    // ──────────────────────────────────────────────────────────────────────
    // POST /api/deployments — X-Progress-Reporter header parameter
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PostDeployments_AdvertisesXProgressReporter_AsHeaderParameter()
    {
        var op = await GetOperationAsync("/api/deployments", "post");

        var parameters = GetParametersOrEmpty(op);
        var header = FindHeaderParameter(parameters, "X-Progress-Reporter");
        Assert.NotNull(header);

        // location = header
        Assert.Equal("header", header!.Value.GetProperty("in").GetString());

        // schema.type = string
        var schema = header.Value.GetProperty("schema");
        Assert.Equal("string", schema.GetProperty("type").GetString());

        // On POST the header is optional (CR-0009 § 3a). Microsoft.AspNetCore.OpenApi
        // infers optionality from the nullable parameter type — so this is correctly
        // surfaced.
        Assert.False(GetRequiredOrFalse(header.Value),
            "X-Progress-Reporter MUST be optional on POST /api/deployments (CR-0009 § 3a).");

        // maxLength = 64 — injected by ProgressReporterHeaderOperationTransformer
        // (CR-0009 + CR-0008). DataAnnotations don't fire on [FromHeader] string
        // bindings, so the cap is added post-generation. SDK / Scalar consumers
        // can now see the cap client-side.
        Assert.True(schema.TryGetProperty("maxLength", out var maxLength),
            "X-Progress-Reporter parameter schema MUST advertise maxLength: 64.");
        Assert.Equal(64, maxLength.GetInt32());
    }

    // ──────────────────────────────────────────────────────────────────────
    // GET /api/fetcher/state/{source-id} — X-Progress-Reporter REQUIRED header
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetFetcherState_EndpointExists_With_XProgressReporterHeader()
    {
        var op = await GetOperationAsync("/api/fetcher/state/{sourceId}", "get");

        var parameters = GetParametersOrEmpty(op);
        var header = FindHeaderParameter(parameters, "X-Progress-Reporter");
        Assert.NotNull(header);

        Assert.Equal("header", header!.Value.GetProperty("in").GetString());
        var schema = header.Value.GetProperty("schema");
        Assert.Equal("string", schema.GetProperty("type").GetString());

        // CR-0009 § 3b — REQUIRED on the fetcher-state endpoints. The
        // ProgressReporterHeaderOperationTransformer flips `required` to true
        // on this operation (matched by operationId = "GetFetcherState").
        // The binding stays `string?` so the runtime validator remains
        // authoritative (missing-header surfaces as 422 from the validator,
        // not 400 from model-binding rejection) — see WriteApiEndpoints.
        Assert.True(GetRequiredOrFalse(header.Value),
            "X-Progress-Reporter MUST be required on GET /api/fetcher/state/{sourceId} (CR-0009 § 3b).");

        // maxLength = 64 — same transformer injects the cap so SDKs / Scalar
        // see it client-side.
        Assert.True(schema.TryGetProperty("maxLength", out var maxLength),
            "X-Progress-Reporter parameter schema MUST advertise maxLength: 64.");
        Assert.Equal(64, maxLength.GetInt32());
    }

    [Fact]
    public async Task PutFetcherState_EndpointExists_With_XProgressReporterHeader()
    {
        var op = await GetOperationAsync("/api/fetcher/state/{sourceId}", "put");

        var parameters = GetParametersOrEmpty(op);
        var header = FindHeaderParameter(parameters, "X-Progress-Reporter");
        Assert.NotNull(header);

        Assert.Equal("header", header!.Value.GetProperty("in").GetString());
        var schema = header.Value.GetProperty("schema");
        Assert.Equal("string", schema.GetProperty("type").GetString());

        // Same as the GET above — REQUIRED per CR-0009 § 3b, flipped by the
        // transformer (operationId = "PutFetcherState").
        Assert.True(GetRequiredOrFalse(header.Value),
            "X-Progress-Reporter MUST be required on PUT /api/fetcher/state/{sourceId} (CR-0009 § 3b).");

        Assert.True(schema.TryGetProperty("maxLength", out var maxLength),
            "X-Progress-Reporter parameter schema MUST advertise maxLength: 64.");
        Assert.Equal(64, maxLength.GetInt32());
    }

    /// <summary>
    /// CR-0009 + ADR-0004 — both fetcher-state endpoints must appear in the
    /// OpenAPI document at the right path + verbs.
    /// </summary>
    [Theory]
    [InlineData("/api/fetcher/state/{sourceId}", "get")]
    [InlineData("/api/fetcher/state/{sourceId}", "put")]
    public async Task FetcherStateEndpoints_AppearInOpenApiPathsTable(string path, string verb)
    {
        var op = await GetOperationAsync(path, verb);
        Assert.False(string.IsNullOrWhiteSpace(op.GetProperty("operationId").GetString()),
            $"{verb.ToUpperInvariant()} {path} missing operationId");
    }

    // ──────────────────────────────────────────────────────────────────────
    // helpers
    // ──────────────────────────────────────────────────────────────────────

    private static IEnumerable<JsonElement> GetParametersOrEmpty(JsonElement op)
    {
        if (!op.TryGetProperty("parameters", out var parameters))
        {
            return Array.Empty<JsonElement>();
        }
        return parameters.EnumerateArray();
    }

    private static JsonElement? FindHeaderParameter(IEnumerable<JsonElement> parameters, string headerName)
    {
        foreach (var p in parameters)
        {
            if (p.TryGetProperty("in", out var location) &&
                location.GetString() == "header" &&
                p.TryGetProperty("name", out var name) &&
                string.Equals(name.GetString(), headerName, StringComparison.OrdinalIgnoreCase))
            {
                return p;
            }
        }
        return null;
    }

    private static bool GetRequiredOrFalse(JsonElement parameter)
    {
        if (parameter.TryGetProperty("required", out var required) &&
            required.ValueKind == JsonValueKind.True)
        {
            return true;
        }
        return false;
    }

    private async Task<JsonElement> GetOperationAsync(string path, string verb)
    {
        var resp = await _client.GetAsync("/openapi/v1.json");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var stream = await resp.Content.ReadAsStreamAsync();
        using var doc = await JsonDocument.ParseAsync(stream);
        var root = doc.RootElement.Clone();

        var paths = root.GetProperty("paths");
        Assert.True(paths.TryGetProperty(path, out var pathItem),
            $"Path '{path}' not found in OpenAPI document. Available paths: " +
            string.Join(", ", paths.EnumerateObject().Select(p => p.Name)));
        Assert.True(pathItem.TryGetProperty(verb, out var op),
            $"Verb '{verb}' not found on path '{path}'.");
        return op;
    }
}
