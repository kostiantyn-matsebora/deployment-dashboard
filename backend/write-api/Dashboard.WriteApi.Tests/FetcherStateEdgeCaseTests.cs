using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Security;

namespace Dashboard.WriteApi.Tests;

/// <summary>
/// CR-0009 — edge cases on the fetcher-state surface that BE explicitly
/// flagged for QA wave 3 (Deviation 2 / Deviation 3 governance hooks):
///
/// <list type="bullet">
///   <item><c>source-id</c> accepts multi-slash values (catch-all route +
///   opaque backend storage).</item>
///   <item>Empty / whitespace <c>source-id</c> shapes — locked to current
///   backend behaviour so future routing changes surface as test changes
///   not silent contract drift.</item>
///   <item>Validation error map uses the literal header name
///   <c>X-Progress-Reporter</c> as the key (lock for SDK pattern-matching).</item>
/// </list>
/// </summary>
public sealed class FetcherStateEdgeCaseTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public FetcherStateEdgeCaseTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static int _idSeed;

    private HttpRequestMessage WithApiKey(HttpRequestMessage req)
    {
        req.Headers.Add(ApiKeyMiddleware.HeaderName, _factory.ApiKey);
        return req;
    }

    private async Task PutCursor(string progressReporter, string sourceId, string cursor)
    {
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/fetcher/state/{sourceId}")
        {
            Content = JsonContent.Create(new FetcherStateRequest { Cursor = cursor }, options: DashboardJson.Options),
        };
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(req));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Multi-slash source-id (BE Deviation 2 governance hook)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Put_FetcherState_MultiSlashSourceId_AcceptedAndRoundTripsViaGet()
    {
        // BE used a catch-all route (`{**sourceId}`) so multi-slash source-ids
        // round-trip verbatim. Adapter authors can use slashed scope ids
        // (e.g. ADO `project/team/repo`, GitLab `group/subgroup/project`) and
        // the backend stores them opaquely.
        const string progressReporter = "dashboard-fetcher/test-adapter";
        var sourceId = $"acme/foo/bar-{Interlocked.Increment(ref _idSeed)}";
        const string cursor = "opaque-cursor-multislash";

        // Upsert with the multi-slash id.
        await PutCursor(progressReporter, sourceId, cursor);

        // Round-trip via GET.
        var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/fetcher/state/{sourceId}");
        getReq.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(getReq));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<FetcherStateResponse>(DashboardJson.Options);
        Assert.NotNull(body);
        Assert.Equal(sourceId, body!.SourceId);
        Assert.Equal(cursor, body.Cursor);
        Assert.Equal(progressReporter, body.ProgressReporter);
    }

    [Fact]
    public async Task Put_FetcherState_TripleSlashSourceId_AcceptedAndRoundTripsViaGet()
    {
        // Lock the catch-all behaviour for arbitrarily-deep path shapes.
        const string progressReporter = "dashboard-fetcher/triple-slash";
        var sourceId = $"acme/team/group/subgroup/repo-{Interlocked.Increment(ref _idSeed)}";

        await PutCursor(progressReporter, sourceId, "c-1");

        var getReq = new HttpRequestMessage(HttpMethod.Get, $"/api/fetcher/state/{sourceId}");
        getReq.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, progressReporter);
        var resp = await _client.SendAsync(WithApiKey(getReq));

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<FetcherStateResponse>(DashboardJson.Options);
        Assert.Equal(sourceId, body!.SourceId);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Empty source-id — locked-current-behaviour test
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Get_FetcherState_TrailingSlash_EmptySourceId_RouteBehaviour_Locked()
    {
        // Catch-all routes (`{**sourceId}`) and ASP.NET model binding handle
        // an empty path segment (just "/api/fetcher/state/") in one of three
        // documented ways:
        //   - 404 (routing did not match the empty segment)
        //   - 400 (model binding rejected the empty path parameter — current behaviour)
        //   - 422 (routing matched + the defensive TryValidateSourceIdPathSegment
        //          rejected whitespace)
        //
        // Discovered behaviour on this stack: 400 (ASP.NET's RoutePatternRequiredValue
        // emits a BadRequest before the handler executes). Lock the union of
        // {400, 404, 422} and reject 200 / 500 / other so a regression that
        // accidentally accepts an empty source-id surfaces loudly.
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/");
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, "dashboard-fetcher/x");
        var resp = await _client.SendAsync(WithApiKey(req));

        var status = (int)resp.StatusCode;
        Assert.True(status == 400 || status == 404 || status == 422,
            $"Expected 400 (model-bind rejection) / 404 (no route match) / 422 (validator rejection); got {status}.");

        if (status == 422)
        {
            // Lock the validator error key when this branch fires.
            var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
            var errors = body.GetProperty("errors");
            Assert.True(errors.TryGetProperty("source-id", out _),
                "When the empty source-id branch returns 422, the error key must be 'source-id'.");
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // 422 errors map uses the LITERAL header name (BE Deviation 3 hook)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Post_Deployments_InvalidProgressReporter_ErrorsKey_IsLiteralXProgressReporter_Case()
    {
        // Lock the exact key shape "X-Progress-Reporter" (preserves case and
        // hyphens). If SA later prefers a different shape (e.g. lower-case
        // "x-progress-reporter" or snake_case "progress_reporter"), this
        // test will fail and force the conversation through Phase 7.
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(new DeploymentEventRequest
            {
                DeploymentId = $"err-key-{Interlocked.Increment(ref _idSeed)}",
                Service = "svc",
                Environment = "dev",
                Version = "v1",
                Status = "success",
                RunUrl = "https://example.com/r/1",
                RunNumber = 1,
                Actor = "tester",
            }, options: DashboardJson.Options),
        };
        // Trigger validation by exceeding the 64-char cap.
        req.Headers.Add(WriteApiEndpoints.ProgressReporterHeaderName, new string('z', 65));

        var resp = await _client.SendAsync(WithApiKey(req));
        Assert.Equal((HttpStatusCode)422, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");

        // Literal key match (case-sensitive, hyphen-preserved).
        Assert.True(errors.TryGetProperty("X-Progress-Reporter", out var prErrors),
            "ValidationProblemDetails.errors MUST use the literal 'X-Progress-Reporter' key " +
            "(case + hyphens preserved). Found: " +
            string.Join(", ", errors.EnumerateObject().Select(p => p.Name)));
        Assert.True(prErrors.GetArrayLength() >= 1);
    }

    [Fact]
    public async Task Get_FetcherState_MissingHeader_ErrorsKey_IsLiteralXProgressReporter_Case()
    {
        // Same governance lock for the required-on-fetcher-state path.
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/fetcher/state/acme%2Frepo");
        // intentionally NO X-Progress-Reporter header
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("X-Progress-Reporter", out _),
            "Expected literal 'X-Progress-Reporter' key in 422 errors map.");
    }
}
