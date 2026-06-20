using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// HTTP+Postgres integration tests for the deployment-wide service-scope filter
/// (SERVICE_INCLUDE / SERVICE_EXCLUDE / REPO_INCLUDE / REPO_EXCLUDE).
///
/// Verifies that the filter hides excluded services on every read surface:
/// <list type="bullet">
///   <item><c>GET /api/services</c> — excluded service absent from items.</item>
///   <item><c>GET /api/matrix</c> — excluded service has no row.</item>
///   <item><c>GET /api/deployments</c> — excluded service absent from items.</item>
///   <item><c>GET /api/deployments/{id}</c> — excluded-service row returns 404.</item>
///   <item>SSE replay (<c>Last-Event-ID</c>) — excluded service absent.</item>
///   <item>SSE live stream (<c>UseRealNotifier</c>) — excluded service events not emitted.</item>
/// </list>
///
/// Test class layout mirrors the existing <see cref="ReadEndpointTests"/> /
/// <see cref="SseReplayTests"/> / <see cref="SseLiveStreamTests"/> pattern.
/// Each class owns one factory configured with specific filter env vars via
/// <see cref="TestApiFactory.ExtraConfiguration"/>.
///
/// GATE NOTE: These tests require a Postgres container (TestContainers).
/// Compilation is verified in the worktree; execution is CI-gated (ci.yml → api.yml on PR).
/// </summary>

// ── Service exclude filter ────────────────────────────────────────────────────

/// <summary>
/// Tests the SERVICE_EXCLUDE filter across all read surfaces.
/// Two services are seeded: <c>scope-visible-svc</c> (passes) and <c>scope-noisy-svc</c>
/// (excluded). Every assertion checks that the excluded service is hidden.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeFilterTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    // Names are unique to this class so other test classes' data does not bleed in.
    private const string VisibleService = "scope-visible-svc";
    private const string ExcludedService = "scope-noisy-svc";

    public ServiceExcludeFilterTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // Exclude one specific service by name — no wildcard needed.
                ["SERVICE_EXCLUDE"] = ExcludedService,
            },
        };
        _client = _factory.CreateClient();
        // Seed both services so the filter has meaningful data to hide.
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
        string environment = "prod",
        string status = "success",
        string happenedAt = "2024-01-01T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
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

    // ── GET /api/deployments/{id} ─────────────────────────────────────────────

    [Fact]
    public async Task ServiceExclude_GetDeploymentById_ExcludedServiceReturns404()
    {
        // Ingest a fresh excluded-service event and capture its id.
        var ingested = await IngestAsync(service: ExcludedService, happenedAt: "2024-06-01T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task ServiceExclude_GetDeploymentById_VisibleServiceReturns200()
    {
        // Verify that the visible service is still fetchable by id.
        var ingested = await IngestAsync(service: VisibleService, happenedAt: "2024-06-02T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(id, body.GetProperty("id").GetString());
    }

    // ── SSE replay (Last-Event-ID) ────────────────────────────────────────────

    [Fact]
    public async Task ServiceExclude_SseReplay_ExcludedServiceAbsentFromReplay()
    {
        // Connect with an anchor id that predates all seeded events.
        var anchorId = Guid.Empty.ToString();

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        var request = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        request.Headers.Add("Last-Event-ID", anchorId);

        using var response = await _client.SendAsync(
            request, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        await using var stream = await response.Content.ReadAsStreamAsync(cts.Token);
        // Read up to 10 events — we only seeded a few visible and excluded events, so 10 is safe.
        var receivedServices = await ReadSseEventServicesAsync(stream, count: 10, cts.Token);

        Assert.Contains(VisibleService, receivedServices);
        Assert.DoesNotContain(ExcludedService, receivedServices);
    }

    // ── Helper: read 'service' field from SSE data lines ─────────────────────

    private static async Task<List<string>> ReadSseEventServicesAsync(
        Stream stream,
        int count,
        CancellationToken ct)
    {
        using var reader = new StreamReader(stream, leaveOpen: true);
        var services = new List<string>();

        while (services.Count < count && !ct.IsCancellationRequested)
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

// ── Service include filter (allowlist) ───────────────────────────────────────

/// <summary>
/// Tests the SERVICE_INCLUDE allowlist filter: only explicitly included services
/// appear on every read surface; all others are hidden.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceIncludeFilterTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string AllowedService = "scope-allowed-svc";
    private const string BlockedService = "scope-blocked-svc";

    public ServiceIncludeFilterTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // Only the allowed service passes; blocked-svc is implicitly hidden.
                ["SERVICE_INCLUDE"] = AllowedService,
            },
        };
        _client = _factory.CreateClient();
        await IngestAsync(service: AllowedService, happenedAt: "2024-02-01T10:00:00Z");
        await IngestAsync(service: BlockedService, happenedAt: "2024-02-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestAsync(
        string service,
        string environment = "prod",
        string happenedAt = "2024-02-01T10:00:00Z")
    {
        var payload = new
        {
            deployment_id = $"gh-{Guid.NewGuid():N}",
            service,
            environment,
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
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    // ── GET /api/services ─────────────────────────────────────────────────────

    [Fact]
    public async Task ServiceInclude_GetServices_OnlyAllowedServiceVisible()
    {
        var res = await _client.GetAsync("/api/services");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Contains(AllowedService, items);
        Assert.DoesNotContain(BlockedService, items);
    }

    // ── GET /api/matrix ───────────────────────────────────────────────────────

    [Fact]
    public async Task ServiceInclude_GetMatrix_OnlyAllowedServiceHasRow()
    {
        var res = await _client.GetAsync("/api/matrix");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rowServices = body.GetProperty("rows").EnumerateArray()
            .Select(r => r.GetProperty("service").GetString()).ToList();

        Assert.Contains(AllowedService, rowServices);
        Assert.DoesNotContain(BlockedService, rowServices);
    }

    // ── GET /api/deployments ──────────────────────────────────────────────────

    [Fact]
    public async Task ServiceInclude_GetDeployments_OnlyAllowedServiceInItems()
    {
        var res = await _client.GetAsync("/api/deployments");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var services = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("service").GetString()).ToList();

        Assert.Contains(AllowedService, services);
        Assert.DoesNotContain(BlockedService, services);
    }

    // ── GET /api/deployments/{id} ─────────────────────────────────────────────

    [Fact]
    public async Task ServiceInclude_GetDeploymentById_NonIncludedServiceReturns404()
    {
        var ingested = await IngestAsync(service: BlockedService, happenedAt: "2024-06-03T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }
}

// ── Repo include/exclude filter ───────────────────────────────────────────────

/// <summary>
/// Tests REPO_EXCLUDE filter. The namespace field on the ingest payload
/// (= repo short name) is matched against the pattern's name segment (right of '/').
/// Two namespaces: <c>ns-visible</c> and <c>ns-hidden</c>.
/// </summary>
[Collection("api-postgres")]
public sealed class RepoFilterTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string VisibleNamespace = "ns-visible";
    private const string HiddenNamespace = "ns-hidden";
    private const string SharedService = "repo-filter-svc";

    public RepoFilterTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // REPO_EXCLUDE pattern: "org/ns-hidden" — name segment "ns-hidden" matched
                // against the namespace field.
                ["REPO_EXCLUDE"] = $"org/{HiddenNamespace}",
            },
        };
        _client = _factory.CreateClient();
        // Same service name, different namespaces.
        await IngestWithNamespaceAsync(SharedService, VisibleNamespace, "2024-03-01T10:00:00Z");
        await IngestWithNamespaceAsync(SharedService, HiddenNamespace, "2024-03-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestWithNamespaceAsync(
        string service,
        string @namespace,
        string happenedAt)
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
        var res = await _client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    // ── GET /api/deployments ──────────────────────────────────────────────────

    [Fact]
    public async Task RepoExclude_GetDeployments_HiddenNamespaceAbsentFromItems()
    {
        var res = await _client.GetAsync("/api/deployments");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var namespaces = body.GetProperty("items").EnumerateArray()
            .Select(e =>
            {
                e.TryGetProperty("namespace", out var ns);
                return ns.GetString();
            }).ToList();

        // The visible namespace must be present; the hidden one must not appear.
        Assert.Contains(VisibleNamespace, namespaces);
        Assert.DoesNotContain(HiddenNamespace, namespaces);
    }

    // ── GET /api/deployments/{id} ─────────────────────────────────────────────

    [Fact]
    public async Task RepoExclude_GetDeploymentById_HiddenNamespaceReturns404()
    {
        var ingested = await IngestWithNamespaceAsync(SharedService, HiddenNamespace, "2024-06-04T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    // ── GET /api/services ─────────────────────────────────────────────────────

    [Fact]
    public async Task RepoExclude_GetServices_HiddenNamespaceServiceAbsent()
    {
        // Both events use the same service name but different namespaces.
        // When ALL namespaces for a service are excluded, the service name must vanish.
        // Here only HiddenNamespace events are excluded; VisibleNamespace events remain,
        // so the service name itself stays visible.
        var res = await _client.GetAsync("/api/services");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        // SharedService is still visible via ns-visible.
        Assert.Contains(SharedService, items);
    }
}

// ── Exclude-wins precedence: service in both include AND exclude → excluded ───

/// <summary>
/// Tests that exclude wins over include when a service appears on both lists.
/// The service is in SERVICE_INCLUDE and SERVICE_EXCLUDE simultaneously;
/// it must be hidden on all read surfaces.
/// </summary>
[Collection("api-postgres")]
public sealed class ExcludeWinsPrecedenceTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string ConflictedService = "scope-conflict-svc";
    private const string SafeService = "scope-safe-svc";

    public ExcludeWinsPrecedenceTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // Both lists contain the same service — exclude must win.
                ["SERVICE_INCLUDE"] = $"{ConflictedService},{SafeService}",
                ["SERVICE_EXCLUDE"] = ConflictedService,
            },
        };
        _client = _factory.CreateClient();
        await IngestAsync(service: ConflictedService, happenedAt: "2024-04-01T10:00:00Z");
        await IngestAsync(service: SafeService, happenedAt: "2024-04-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestAsync(string service, string happenedAt)
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
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task ExcludeWins_GetServices_ConflictedServiceIsHidden()
    {
        var res = await _client.GetAsync("/api/services");

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        // Exclude wins: ConflictedService must be hidden even though it is also in SERVICE_INCLUDE.
        Assert.DoesNotContain(ConflictedService, items);
        Assert.Contains(SafeService, items);
    }

    [Fact]
    public async Task ExcludeWins_GetDeployments_ConflictedServiceAbsentFromItems()
    {
        var res = await _client.GetAsync("/api/deployments");

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var services = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("service").GetString()).ToList();

        Assert.DoesNotContain(ConflictedService, services);
        Assert.Contains(SafeService, services);
    }

    [Fact]
    public async Task ExcludeWins_GetDeploymentById_ConflictedServiceReturns404()
    {
        var ingested = await IngestAsync(ConflictedService, "2024-06-05T00:00:00Z");
        var id = ingested.GetProperty("id").GetString();

        var res = await _client.GetAsync($"/api/deployments/{id}");

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task ExcludeWins_GetMatrix_ConflictedServiceHasNoRow()
    {
        var res = await _client.GetAsync("/api/matrix");

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rowServices = body.GetProperty("rows").EnumerateArray()
            .Select(r => r.GetProperty("service").GetString()).ToList();

        Assert.DoesNotContain(ConflictedService, rowServices);
        Assert.Contains(SafeService, rowServices);
    }
}

// ── Empty defaults: no vars → everything visible (no regression) ──────────────

/// <summary>
/// Tests the empty-defaults case: when no SERVICE_*/REPO_* vars are set, all
/// seeded services appear on every read surface (pass-all behaviour preserved).
/// </summary>
[Collection("api-postgres")]
public sealed class EmptyDefaultsNoFilterTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string ServiceA = "scope-default-svc-a";
    private const string ServiceB = "scope-default-svc-b";

    public EmptyDefaultsNoFilterTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        // No ExtraConfiguration — SERVICE_*/REPO_* are absent; filter is pass-all.
        _factory = new TestApiFactory(_fixture.ConnectionString);
        _client = _factory.CreateClient();
        await IngestAsync(service: ServiceA, happenedAt: "2024-05-01T10:00:00Z");
        await IngestAsync(service: ServiceB, happenedAt: "2024-05-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    private async Task<JsonElement> IngestAsync(string service, string happenedAt)
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
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task EmptyDefaults_GetServices_AllServicesVisible()
    {
        var res = await _client.GetAsync("/api/services");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.Contains(ServiceA, items);
        Assert.Contains(ServiceB, items);
    }

    [Fact]
    public async Task EmptyDefaults_GetMatrix_AllServicesHaveRows()
    {
        var res = await _client.GetAsync("/api/matrix");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var rowServices = body.GetProperty("rows").EnumerateArray()
            .Select(r => r.GetProperty("service").GetString()).ToList();

        Assert.Contains(ServiceA, rowServices);
        Assert.Contains(ServiceB, rowServices);
    }

    [Fact]
    public async Task EmptyDefaults_GetDeployments_AllServicesInItems()
    {
        var res = await _client.GetAsync("/api/deployments");

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var services = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetProperty("service").GetString()).ToList();

        Assert.Contains(ServiceA, services);
        Assert.Contains(ServiceB, services);
    }
}

// ── SSE live stream with service-scope filter ────────────────────────────────

/// <summary>
/// Tests the SSE live-stream path with SERVICE_EXCLUDE active.
/// Uses <c>UseRealNotifier = true</c> so the ingest → pg_notify → broadcaster →
/// SSE channel fan-out path is fully exercised.
/// Excluded-service events must not arrive on the SSE stream.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceScopeFilterSseLiveTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    private const string LiveVisibleService = "scope-live-visible-svc";
    private const string LiveExcludedService = "scope-live-excluded-svc";

    public ServiceScopeFilterSseLiveTests(PostgresFixture fixture) => _fixture = fixture;

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

    [Fact]
    public async Task ServiceExclude_SseLive_VisibleServiceEventArrives()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        var sseRequest = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        using var sseResponse = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, sseResponse.StatusCode);

        await using var stream = await sseResponse.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        var receivedId = new TaskCompletionSource<string>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(
            () => WaitForServiceEventAsync(reader, LiveVisibleService, receivedId, cts.Token),
            cts.Token);

        // Allow the SSE subscription to register before ingesting.
        await Task.Delay(300, cts.Token);

        var ingested = await IngestAsync(service: LiveVisibleService);
        var expectedId = ingested.GetProperty("id").GetString()!;

        var arrived = await receivedId.Task.WaitAsync(cts.Token);
        Assert.Equal(expectedId, arrived);

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }
    }

    [Fact]
    public async Task ServiceExclude_SseLive_ExcludedServiceEventNeverArrives()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        var sseRequest = new HttpRequestMessage(HttpMethod.Get, "/api/events/stream");
        using var sseResponse = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);

        Assert.Equal(HttpStatusCode.OK, sseResponse.StatusCode);

        await using var stream = await sseResponse.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        // Brief watch window: 3 s after ingest to catch any leaked events.
        using var watchCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cts.Token, watchCts.Token);

        var leaked = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(
            () => DetectServiceEventAsync(reader, LiveExcludedService, leaked, linked.Token),
            linked.Token);

        await Task.Delay(200, cts.Token);

        // Ingest the excluded service event — it must not reach the SSE stream.
        await IngestAsync(service: LiveExcludedService);

        try { await readTask; } catch (OperationCanceledException) { }

        Assert.False(leaked.Task.IsCompletedSuccessfully && await leaked.Task,
            $"SSE live stream must not emit events for service '{LiveExcludedService}' (SERVICE_EXCLUDE).");
    }

    // ── SSE stream background-reader helpers ─────────────────────────────────

    /// <summary>
    /// Reads SSE data lines until an event for <paramref name="targetService"/> arrives,
    /// then signals <paramref name="result"/> with the event id.
    /// </summary>
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

    /// <summary>
    /// Reads SSE data lines; sets <paramref name="leaked"/> to <c>true</c> if any event
    /// for <paramref name="excludedService"/> arrives within the cancellation window.
    /// </summary>
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
