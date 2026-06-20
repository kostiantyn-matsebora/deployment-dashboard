using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// HTTP+Postgres integration tests for the deployment-wide service-scope filter
/// (single <c>SERVICE_EXCLUDE</c> variable — issue #348 / PR #382).
///
/// <c>SERVICE_EXCLUDE</c> is a CSV of <c>owner/repo/service</c> glob patterns.
/// On the API, the match uses the pattern's last two segments <c>repo/service</c>
/// against the event's <c>(namespace, service)</c>; the leading owner segment is
/// wildcarded because the API does not store owner (<c>namespace</c> == repo short name).
///
/// Surfaces verified:
/// <list type="bullet">
///   <item>READ: <c>GET /api/services</c>, <c>GET /api/matrix</c>,
///     <c>GET /api/deployments</c>, <c>GET /api/deployments/{id}</c>.</item>
///   <item>WRITE: <c>POST /api/deployments</c> — excluded event → 403 problem+json;
///     non-excluded → 201.</item>
///   <item>SSE replay (<c>Last-Event-ID</c>) — excluded events suppressed.</item>
///   <item>SSE live stream (<c>UseRealNotifier=true</c>) — excluded events not emitted.</item>
///   <item>Glob coverage: owner wildcard, namespace-qualified patterns, wildcard service segment.</item>
///   <item>Empty <c>SERVICE_EXCLUDE</c> — pass-all; all services visible and POST returns 201.</item>
/// </list>
///
/// GATE NOTE: These tests require a Postgres container (Testcontainers / Docker).
/// Compilation is verified locally; execution is CI-gated (ci.yml → api.yml on PR).
/// </summary>

// ── READ filtering — excluded service absent on all read surfaces ─────────────

/// <summary>
/// Verifies that a service matching <c>SERVICE_EXCLUDE</c> is hidden on every read
/// surface and that a non-excluded service remains fully visible.
///
/// Pattern used: single-segment <c>scope-excl-read-svc</c> (owner/repo wildcarded
/// by <see cref="ServiceFilter.SplitPattern"/>).
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeReadFilterTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    // Unique service names — prevent bleed from other test classes in the shared DB.
    private const string VisibleService = "scope-excl-read-visible";
    private const string ExcludedService = "scope-excl-read-hidden";

    public ServiceExcludeReadFilterTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();

        // Single-segment pattern: owner and repo are wildcarded; only service is literal.
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = ExcludedService,
            },
        };
        _client = _factory.CreateClient();

        // Seed both services so the filter has data to hide and data to show.
        await IngestAsync(service: VisibleService, happenedAt: "2024-01-01T10:00:00Z");
        await IngestAsync(service: ExcludedService, happenedAt: "2024-01-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestAsync(
        string service,
        string? @namespace = null,
        string environment = "prod",
        string status = "success",
        string happenedAt = "2024-01-01T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            @namespace,
            environment,
            status,
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    // ── GET /api/services ─────────────────────────────────────────────────────

    [Fact]
    public async Task ServiceExclude_GetServices_ExcludedServiceAbsentFromItems()
    {
        var res = await _client.GetAsync("/api/services");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Contains(VisibleService, items);
        Assert.DoesNotContain(ExcludedService, items);
    }

    // ── GET /api/matrix ───────────────────────────────────────────────────────

    [Fact]
    public async Task ServiceExclude_GetMatrix_ExcludedServiceHasNoRow()
    {
        var res = await _client.GetAsync("/api/matrix");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rowServices = body.GetProperty("rows").EnumerateArray()
            .Select(r => r.GetProperty("service").GetString()).ToList();

        Assert.Contains(VisibleService, rowServices);
        Assert.DoesNotContain(ExcludedService, rowServices);
    }

    // ── GET /api/deployments ──────────────────────────────────────────────────

    [Fact]
    public async Task ServiceExclude_GetDeployments_ExcludedServiceAbsentFromItems()
    {
        var res = await _client.GetAsync("/api/deployments");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var services = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("service").GetString()).ToList();

        Assert.Contains(VisibleService, services);
        Assert.DoesNotContain(ExcludedService, services);
    }

    // ── GET /api/deployments/{id} — excluded → 404 ───────────────────────────

    [Fact]
    public async Task ServiceExclude_GetDeploymentById_ExcludedServiceReturns404ProblemJson()
    {
        // Ingest a fresh excluded event; capture its id directly from the POST response.
        var ingested = await IngestAsync(service: ExcludedService, happenedAt: "2024-06-01T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    // ── GET /api/deployments/{id} — visible → 200 ────────────────────────────

    [Fact]
    public async Task ServiceExclude_GetDeploymentById_VisibleServiceReturns200()
    {
        var ingested = await IngestAsync(service: VisibleService, happenedAt: "2024-06-02T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(id, body.GetProperty("id").GetString());
    }
}

// ── WRITE rejection — POST returns 403 for excluded, 201 for visible ─────────

/// <summary>
/// Verifies that the ingest endpoint enforces <c>SERVICE_EXCLUDE</c> on POST:
/// an event whose <c>(namespace, service)</c> matches the filter receives
/// <c>403 Forbidden</c> with <c>application/problem+json</c>; a non-matching event
/// still returns <c>201 Created</c>.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeWriteRejectionTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string VisibleService = "scope-excl-write-visible";
    private const string ExcludedService = "scope-excl-write-hidden";

    public ServiceExcludeWriteRejectionTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = ExcludedService,
            },
        };
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private HttpRequestMessage BuildPost(string service, string? @namespace = null)
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            @namespace,
            environment = "prod",
            status = "success",
            happened_at = "2024-07-01T10:00:00Z",
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        return msg;
    }

    // ── Excluded service → 403 problem+json ──────────────────────────────────

    [Fact]
    public async Task ServiceExclude_Post_ExcludedServiceReturns403ProblemJson()
    {
        var res = await _client.SendAsync(BuildPost(ExcludedService));

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task ServiceExclude_Post_ExcludedServiceWithNamespace_Returns403()
    {
        // Two-segment pattern "my-ns/scope-excl-write-ns-svc" ensures namespace is matched.
        var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "my-ns/scope-excl-write-ns-svc",
            },
        };
        await using var _ = factory;
        using var client = factory.CreateClient();

        // Matching namespace + service → 403.
        var matchRes = await client.SendAsync(
            BuildPost("scope-excl-write-ns-svc", @namespace: "my-ns"));
        Assert.Equal(HttpStatusCode.Forbidden, matchRes.StatusCode);

        // Different namespace → 201 (namespace pattern mismatch).
        var noMatchRes = await client.SendAsync(
            BuildPost("scope-excl-write-ns-svc", @namespace: "other-ns"));
        Assert.Equal(HttpStatusCode.Created, noMatchRes.StatusCode);
    }

    // ── Visible (non-excluded) service → 201 ─────────────────────────────────

    [Fact]
    public async Task ServiceExclude_Post_VisibleServiceReturns201()
    {
        var res = await _client.SendAsync(BuildPost(VisibleService));

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        Assert.NotNull(res.Headers.Location);
    }
}

// ── SSE replay — excluded events suppressed in Last-Event-ID replay ───────────

/// <summary>
/// Verifies that SSE replay (via <c>Last-Event-ID</c>) omits events for excluded services.
/// Uses the default NullNotifier so no LISTEN/NOTIFY is required.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeSseReplayTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string ReplayVisibleService = "scope-sse-replay-visible";
    private const string ReplayExcludedService = "scope-sse-replay-hidden";

    public ServiceExcludeSseReplayTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = ReplayExcludedService,
            },
        };
        _client = _factory.CreateClient();

        // Seed both before connecting — replay will replay them through the filter.
        await IngestAsync(ReplayVisibleService, "2024-01-02T10:00:00Z");
        await IngestAsync(ReplayExcludedService, "2024-01-02T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task IngestAsync(string service, string happenedAt)
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task ServiceExclude_SseReplay_ExcludedServiceAbsentFromReplay()
    {
        // Anchor at Guid.Empty — predates every seeded row — so all rows replay.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        request.Headers.Add("Last-Event-ID", Guid.Empty.ToString());

        using var response = await _client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        var receivedServices = await ReadSseServicesAsync(stream, maxEvents: 10, cts.Token);

        Assert.Contains(ReplayVisibleService, receivedServices);
        Assert.DoesNotContain(ReplayExcludedService, receivedServices);
    }

    // ── SSE data-line reader ─────────────────────────────────────────────────

    private static async Task<List<string>> ReadSseServicesAsync(
        Stream stream, int maxEvents, CancellationToken ct)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var services = new List<string>();

        while (services.Count < maxEvents && !ct.IsCancellationRequested)
        {
            string? line;
            try { line = await reader.ReadLineAsync(ct); }
            catch (OperationCanceledException) { break; }

            if (line is null) break;
            if (!line.StartsWith("data: ")) continue;

            var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
            if (json.TryGetProperty("service", out var svcProp) &&
                svcProp.GetString() is { } svc)
                services.Add(svc);
        }

        return services;
    }
}

// ── SSE live stream — excluded events not emitted via LISTEN/NOTIFY ───────────

/// <summary>
/// Verifies that the SSE live path (pg_notify → broadcaster → channel) suppresses
/// events for excluded services. Uses <c>UseRealNotifier = true</c> so the full
/// ingest → pg_notify → <see cref="DeploymentEventBroadcaster"/> → SSE fan-out
/// path is exercised end-to-end.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeSseLiveTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string LiveVisibleService = "scope-sse-live-visible";
    private const string LiveExcludedService = "scope-sse-live-hidden";

    public ServiceExcludeSseLiveTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            UseRealNotifier = true,
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = LiveExcludedService,
            },
        };
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestAsync(string service)
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = "2024-07-01T12:00:00Z",
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    // ── Visible service event arrives on live stream ──────────────────────────

    [Fact]
    public async Task ServiceExclude_SseLive_VisibleServiceEventArrives()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        var sseRequest = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        using var sseResp = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, sseResp.StatusCode);

        await using var stream = await sseResp.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        var receivedId = new TaskCompletionSource<string>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(
            () => WaitForServiceEventAsync(reader, LiveVisibleService, receivedId, cts.Token),
            cts.Token);

        // Allow the SSE subscription to register before ingesting.
        await Task.Delay(300, cts.Token);

        var ingested = await IngestAsync(LiveVisibleService);
        var expectedId = ingested.GetProperty("id").GetString()!;

        var arrived = await receivedId.Task.WaitAsync(cts.Token);
        Assert.Equal(expectedId, arrived);

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }
    }

    // ── Excluded service event is NOT emitted on live stream ─────────────────

    [Fact]
    public async Task ServiceExclude_SseLive_ExcludedServiceEventNeverArrives()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        var sseRequest = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        using var sseResp = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, sseResp.StatusCode);

        await using var stream = await sseResp.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        // 3-second observation window after ingest to detect any leaked event.
        using var watchCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cts.Token, watchCts.Token);

        var leaked = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(
            () => DetectServiceEventAsync(reader, LiveExcludedService, leaked, linked.Token),
            linked.Token);

        await Task.Delay(200, cts.Token);

        // Ingest the excluded-service event — must not reach the SSE stream.
        await IngestAsync(LiveExcludedService);

        try { await readTask; } catch (OperationCanceledException) { }

        Assert.False(
            leaked.Task.IsCompletedSuccessfully && await leaked.Task,
            $"SSE live stream must not emit events for service '{LiveExcludedService}' " +
            "when it matches SERVICE_EXCLUDE.");
    }

    // ── SSE stream reader helpers ─────────────────────────────────────────────

    private static async Task WaitForServiceEventAsync(
        StreamReader reader,
        string targetService,
        TaskCompletionSource<string> result,
        CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            string? line;
            try { line = await reader.ReadLineAsync(ct); }
            catch (OperationCanceledException) { break; }

            if (line is null) break;
            if (!line.StartsWith("data: ")) continue;

            var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
            if (json.TryGetProperty("service", out var svc) &&
                svc.GetString() == targetService)
            {
                result.TrySetResult(json.GetProperty("id").GetString()!);
                return;
            }
        }
    }

    private static async Task DetectServiceEventAsync(
        StreamReader reader,
        string excludedService,
        TaskCompletionSource<bool> leaked,
        CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            string? line;
            try { line = await reader.ReadLineAsync(ct); }
            catch (OperationCanceledException) { break; }

            if (line is null) break;
            if (!line.StartsWith("data: ")) continue;

            var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
            if (json.TryGetProperty("service", out var svc) &&
                svc.GetString() == excludedService)
            {
                leaked.TrySetResult(true);
                return;
            }
        }
    }
}

// ── Glob pattern coverage ─────────────────────────────────────────────────────

/// <summary>
/// Verifies the three main pattern forms understood by <see cref="ServiceFilter"/>
/// when exercised through the full HTTP+Postgres stack:
/// <list type="bullet">
///   <item><c>*/{repo}/{service}</c> — owner wildcard, specific repo+service.</item>
///   <item><c>{repo}/{service}</c> — two-segment; owner wildcarded by <see cref="ServiceFilter.SplitPattern"/>.</item>
///   <item><c>*/{repo}/*</c> — service wildcard; all services under a given namespace excluded.</item>
/// </list>
/// A non-excluded service is always seeded alongside to prove the filter is not
/// rejecting everything.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeGlobCoverageTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;

    public ServiceExcludeGlobCoverageTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync() => await _fixture.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ── Three-segment owner-wildcard: */repo/service ──────────────────────────

    [Fact]
    public async Task GlobCoverage_OwnerWildcard_ThreeSegmentPattern_ExcludesMatchingService()
    {
        // Pattern "*/glob-ns-a/glob-svc-a" — owner segment is "*"
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "*/glob-ns-a/glob-svc-a",
            },
        };
        using var client = factory.CreateClient();

        await IngestAsync(client, service: "glob-svc-a", @namespace: "glob-ns-a",
            happenedAt: "2024-02-01T10:00:00Z");
        await IngestAsync(client, service: "glob-svc-safe", @namespace: "glob-ns-a",
            happenedAt: "2024-02-01T11:00:00Z");

        var res = await client.GetAsync("/api/services");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.DoesNotContain("glob-svc-a", items);   // excluded
        Assert.Contains("glob-svc-safe", items);   // not excluded
    }

    // ── Two-segment repo/service (owner implicit wildcard) ────────────────────

    [Fact]
    public async Task GlobCoverage_TwoSegmentPattern_ExcludesMatchingNamespaceAndService()
    {
        // Pattern "glob-ns-b/glob-svc-b" — parsed as ["*","glob-ns-b","glob-svc-b"].
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "glob-ns-b/glob-svc-b",
            },
        };
        using var client = factory.CreateClient();

        await IngestAsync(client, service: "glob-svc-b", @namespace: "glob-ns-b",
            happenedAt: "2024-02-02T10:00:00Z");
        // Same service, different namespace — must remain visible.
        await IngestAsync(client, service: "glob-svc-b", @namespace: "other-ns",
            happenedAt: "2024-02-02T11:00:00Z");

        var res = await client.GetAsync("/api/deployments");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        // The "glob-ns-b" namespace event must be hidden.
        var hiddenRow = items.FirstOrDefault(e =>
            e.TryGetProperty("namespace", out var ns) &&
            ns.GetString() == "glob-ns-b");
        Assert.Equal(default, hiddenRow);

        // The "other-ns" row must still be present.
        var visibleRow = items.FirstOrDefault(e =>
            e.TryGetProperty("namespace", out var ns) &&
            ns.GetString() == "other-ns");
        Assert.NotEqual(default, visibleRow);
    }

    // ── Service wildcard: */namespace/* (all services under a namespace) ──────

    [Fact]
    public async Task GlobCoverage_ServiceWildcard_ExcludesAllServicesUnderNamespace()
    {
        // Pattern "*/glob-ns-c/*" — excludes every service in namespace glob-ns-c.
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "*/glob-ns-c/*",
            },
        };
        using var client = factory.CreateClient();

        await IngestAsync(client, service: "glob-svc-c1", @namespace: "glob-ns-c",
            happenedAt: "2024-02-03T10:00:00Z");
        await IngestAsync(client, service: "glob-svc-c2", @namespace: "glob-ns-c",
            happenedAt: "2024-02-03T11:00:00Z");
        // Different namespace — must remain visible.
        await IngestAsync(client, service: "glob-svc-c3", @namespace: "glob-ns-d",
            happenedAt: "2024-02-03T12:00:00Z");

        var res = await client.GetAsync("/api/deployments");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        var nsValues = items
            .Select(e => e.TryGetProperty("namespace", out var ns) ? ns.GetString() : null)
            .ToList();

        // All glob-ns-c rows must be gone.
        Assert.DoesNotContain("glob-ns-c", nsValues);
        // glob-ns-d row must be present.
        Assert.Contains("glob-ns-d", nsValues);
    }

    // ── POST 403 with three-segment owner-wildcard pattern ────────────────────

    [Fact]
    public async Task GlobCoverage_OwnerWildcard_PostReturns403ForMatchingService()
    {
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "*/glob-ns-e/glob-svc-e",
            },
        };
        using var client = factory.CreateClient();

        var res = await PostAsync(client, service: "glob-svc-e", @namespace: "glob-ns-e");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static async Task<JsonElement> IngestAsync(
        HttpClient client,
        string service,
        string? @namespace = null,
        string happenedAt = "2024-01-01T10:00:00Z")
    {
        var res = await PostAsync(client, service, @namespace, happenedAt);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static Task<HttpResponseMessage> PostAsync(
        HttpClient client,
        string service,
        string? @namespace = null,
        string happenedAt = "2024-01-01T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            @namespace,
            environment = "prod",
            status = "success",
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        return client.SendAsync(msg);
    }
}

// ── Empty SERVICE_EXCLUDE — pass-all; everything visible + POST returns 201 ───

/// <summary>
/// No-regression test: when <c>SERVICE_EXCLUDE</c> is absent (or empty) the filter
/// is pass-all. Every seeded service must appear on every read surface and every
/// POST must return <c>201 Created</c>.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeEmptyDefaultsTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string ServiceA = "scope-no-filter-svc-a";
    private const string ServiceB = "scope-no-filter-svc-b";

    public ServiceExcludeEmptyDefaultsTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        // No ExtraConfiguration → SERVICE_EXCLUDE absent → pass-all.
        _factory = new TestApiFactory(_fixture.ConnectionString);
        _client = _factory.CreateClient();

        await IngestAsync(ServiceA, "2024-05-01T10:00:00Z");
        await IngestAsync(ServiceB, "2024-05-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task IngestAsync(string service, string happenedAt)
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = happenedAt,
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
    }

    // ── All services visible ──────────────────────────────────────────────────

    [Fact]
    public async Task EmptyServiceExclude_GetServices_AllServicesVisible()
    {
        var res = await _client.GetAsync("/api/services");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains(ServiceA, items);
        Assert.Contains(ServiceB, items);
    }

    [Fact]
    public async Task EmptyServiceExclude_GetMatrix_AllServicesHaveRows()
    {
        var res = await _client.GetAsync("/api/matrix");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rowServices = body.GetProperty("rows").EnumerateArray()
            .Select(r => r.GetProperty("service").GetString()).ToList();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains(ServiceA, rowServices);
        Assert.Contains(ServiceB, rowServices);
    }

    [Fact]
    public async Task EmptyServiceExclude_GetDeployments_AllServicesInItems()
    {
        var res = await _client.GetAsync("/api/deployments");
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var services = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("service").GetString()).ToList();

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains(ServiceA, services);
        Assert.Contains(ServiceB, services);
    }

    // ── POST → 201 with no filter active ─────────────────────────────────────

    [Fact]
    public async Task EmptyServiceExclude_Post_AnyServiceReturns201()
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service = ServiceA,
            environment = "staging",
            status = "success",
            happened_at = "2024-08-01T10:00:00Z",
        };
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);

        var res = await _client.SendAsync(msg);

        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }
}
