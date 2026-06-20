using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Dashboard.Api.Tests;

/// <summary>
/// HTTP+Postgres integration tests for the deployment-wide service-scope filter
/// (single <c>SERVICE_EXCLUDE</c> variable — issue #348 / PR #382).
///
/// <c>SERVICE_EXCLUDE</c> is a CSV of glob patterns matched against the opaque
/// <c>namespace/service</c> composite identity. Slashless patterns match service
/// name only (all namespaces); slashed patterns match the composite identity where
/// <c>'*'</c> spans <c>'/'</c> (namespace is opaque and MAY contain <c>'/'</c>).
///
/// Surfaces verified:
/// <list type="bullet">
///   <item>READ: <c>GET /api/services</c>, <c>GET /api/matrix</c>,
///     <c>GET /api/deployments</c>, <c>GET /api/deployments/{id}</c>.</item>
///   <item>WRITE: <c>POST /api/deployments</c> — excluded event → 403 problem+json;
///     non-excluded → 201.</item>
///   <item>SSE replay (<c>Last-Event-ID</c>) — excluded events suppressed.</item>
///   <item>SSE live stream (<c>UseRealNotifier=true</c>) — excluded events not emitted.</item>
///   <item>Glob coverage for the opaque identity: slashless, composite, wildcard,
///     multi-segment namespace with slash, and empty pass-all.</item>
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
/// Pattern used: single-segment (slashless) pattern — matched against service name
/// across all namespaces.
///
/// Excluded events are seeded directly into the database (bypassing the write
/// endpoint, which correctly rejects them with 403) to represent the
/// "already-stored / legacy" scenario that the read filter is designed to handle.
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

        // Single-segment pattern: matched against service name only across all namespaces.
        _factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = ExcludedService,
            },
        };
        _client = _factory.CreateClient();

        // Seed the visible service via POST (permitted — not excluded).
        await IngestAsync(service: VisibleService, happenedAt: "2024-01-01T10:00:00Z");

        // Seed the excluded service directly into the DB, bypassing the write endpoint
        // (which correctly rejects it with 403). This represents the "already-stored /
        // legacy" scenario that the read-side filter is designed to handle.
        await SeedExcludedEventAsync(
            service: ExcludedService,
            @namespace: null,
            happenedAt: "2024-01-01T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    /// <summary>
    /// Inserts a <see cref="DeploymentEvent"/> row directly into the database via EF Core,
    /// bypassing the write endpoint. Used to represent events that were stored before
    /// SERVICE_EXCLUDE was configured (the "legacy / already-stored" scenario).
    /// Returns the assigned UUIDv7 id so callers can assert per-id behaviour.
    /// </summary>
    private async Task<Guid> SeedExcludedEventAsync(
        string service,
        string? @namespace,
        string happenedAt,
        string environment = "prod",
        string status = "success")
    {
        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .Options;
        await using var db = new DashboardDbContext(opts);

        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"seed-{Guid.NewGuid():N}",
            Service = service,
            Namespace = @namespace,
            Environment = environment,
            Status = status,
            HappenedAt = DateTimeOffset.Parse(happenedAt),
        };

        db.DeploymentEvents.Add(ev);
        await db.SaveChangesAsync();
        return ev.Id;
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
        // Insert an excluded event directly into the DB to obtain its id.
        // (POST is correctly rejected with 403 for excluded services.)
        var id = await SeedExcludedEventAsync(
            service: ExcludedService,
            @namespace: null,
            happenedAt: "2024-06-01T00:00:00Z");

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
        // Two-segment pattern "my-ns/scope-excl-write-ns-svc" — slashed composite identity.
        // The pattern contains a slash so it is matched against the "namespace/service" composite.
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
///
/// The excluded event is inserted directly into the database (bypassing the write
/// endpoint, which correctly rejects it with 403) to represent the "already-stored /
/// legacy" scenario the replay filter is designed to suppress.
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

        // Seed the visible service via POST (permitted — not excluded).
        await IngestAsync(ReplayVisibleService, "2024-01-02T10:00:00Z");

        // Seed the excluded service directly into the DB so replay has something to filter.
        // The write endpoint correctly rejects excluded services with 403; direct DB insert
        // represents the "already-stored / legacy" scenario.
        await SeedExcludedEventAsync(ReplayExcludedService, "2024-01-02T11:00:00Z");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    /// <summary>
    /// Inserts a <see cref="DeploymentEvent"/> row directly into the database via EF Core,
    /// bypassing the write endpoint. Used to represent events stored before SERVICE_EXCLUDE
    /// was configured.
    /// </summary>
    private async Task SeedExcludedEventAsync(string service, string happenedAt)
    {
        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .Options;
        await using var db = new DashboardDbContext(opts);

        db.DeploymentEvents.Add(new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"seed-{Guid.NewGuid():N}",
            Service = service,
            Environment = "prod",
            Status = "success",
            HappenedAt = DateTimeOffset.Parse(happenedAt),
        });
        await db.SaveChangesAsync();
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
///
/// The excluded event cannot be POSTed (the write endpoint correctly returns 403).
/// Instead, it is inserted directly into the database and then
/// <c>pg_notify('deployment_events', '&lt;id&gt;')</c> is issued on the fixture
/// connection, replicating the notification that the write endpoint would have
/// issued. The broadcaster receives the notification, resolves the row, applies the
/// SERVICE_EXCLUDE read filter, and must suppress the event before fan-out.
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

    /// <summary>
    /// Inserts a <see cref="DeploymentEvent"/> row directly into the database and then
    /// issues <c>pg_notify('deployment_events', '&lt;id&gt;')</c> to drive the live
    /// broadcaster path without going through the write endpoint (which correctly
    /// returns 403 for excluded services).
    /// </summary>
    private async Task<Guid> SeedExcludedEventAndNotifyAsync(
        string service,
        string happenedAt = "2024-07-01T12:00:00Z")
    {
        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .Options;
        await using var db = new DashboardDbContext(opts);

        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"seed-{Guid.NewGuid():N}",
            Service = service,
            Environment = "prod",
            Status = "success",
            HappenedAt = DateTimeOffset.Parse(happenedAt),
        };
        db.DeploymentEvents.Add(ev);
        await db.SaveChangesAsync();

        // Issue the same NOTIFY that PostgresDeploymentNotifier would have sent,
        // so the broadcaster's LISTEN loop receives the event id and tries to fan it out.
        // The broadcaster resolves the row via IDeploymentReadRepository (which applies
        // the SERVICE_EXCLUDE read filter) and must suppress the event.
        await using var conn = new NpgsqlConnection(_fixture.ConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT pg_notify('deployment_events', '{ev.Id}')";
        await cmd.ExecuteNonQueryAsync();

        return ev.Id;
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

        // 3-second observation window after notify to detect any leaked event.
        using var watchCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cts.Token, watchCts.Token);

        var leaked = new TaskCompletionSource<bool>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(
            () => DetectServiceEventAsync(reader, LiveExcludedService, leaked, linked.Token),
            linked.Token);

        await Task.Delay(200, cts.Token);

        // Insert the excluded-service event into the DB and notify the broadcaster.
        // The broadcaster must resolve and then suppress the event because it matches
        // SERVICE_EXCLUDE. The event must never reach the SSE stream.
        await SeedExcludedEventAndNotifyAsync(LiveExcludedService);

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
/// Exercises the full glob pattern vocabulary against the opaque
/// <c>namespace/service</c> composite identity model through the HTTP+Postgres stack.
///
/// Patterns under test:
/// <list type="bullet">
///   <item>(a) <b>Slashless</b> — <c>svc</c> excludes that service across all namespaces.</item>
///   <item>(b) <b>Composite</b> — <c>ns/svc</c> excludes only that namespace's service;
///     a different namespace with the same service name remains visible.</item>
///   <item>(c) <b>Wildcard composite</b> — <c>*/svc</c> matches the service under any namespace
///     (requires a namespace to be present; no-namespace identity is just <c>svc</c> without a slash).</item>
///   <item>(d) <b>Namespace with slash</b> — namespace <c>acme/api</c>, service <c>checkout</c>;
///     pattern <c>acme/api/checkout</c> (full literal), <c>acme/*</c> (star spans <c>/</c>),
///     and slashless <c>checkout</c> all exclude it.</item>
///   <item>(e) <b>Empty SERVICE_EXCLUDE</b> — pass-all; everything visible and POST returns 201
///     (covered by <see cref="ServiceExcludeEmptyDefaultsTests"/>).</item>
/// </list>
///
/// Excluded events are seeded directly into the database (bypassing the write
/// endpoint, which correctly rejects them with 403) to represent the
/// "already-stored / legacy" scenario that the read filter handles.
/// </summary>
[Collection("api-postgres")]
public sealed class ServiceExcludeGlobCoverageTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;

    public ServiceExcludeGlobCoverageTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync() => await _fixture.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ── (a) Slashless pattern — excludes matching service across all namespaces ─

    [Fact]
    public async Task GlobCoverage_Slashless_ExcludesServiceAcrossAllNamespaces()
    {
        // Pattern "glob-svc-a" is slashless — matched against service name only.
        // The same service under any namespace (or no namespace) must be excluded.
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "glob-svc-a",
            },
        };
        using var client = factory.CreateClient();

        // Excluded: same service under two different namespaces, seeded directly into DB.
        await SeedExcludedEventAsync(
            service: "glob-svc-a",
            @namespace: "ns-one",
            happenedAt: "2024-02-01T10:00:00Z");
        await SeedExcludedEventAsync(
            service: "glob-svc-a",
            @namespace: "ns-two",
            happenedAt: "2024-02-01T10:01:00Z");

        // Visible: different service under the same namespace — POST is permitted.
        await IngestAsync(client, service: "glob-svc-safe", @namespace: "ns-one",
            happenedAt: "2024-02-01T11:00:00Z");

        var res = await client.GetAsync("/api/services");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray()
            .Select(e => e.GetString()).ToList();

        Assert.DoesNotContain("glob-svc-a", items);   // excluded across all namespaces
        Assert.Contains("glob-svc-safe", items);       // not excluded
    }

    // ── (b) Composite ns/svc — excludes only that namespace's service ──────────

    [Fact]
    public async Task GlobCoverage_CompositePattern_ExcludesMatchingNamespaceServiceOnly()
    {
        // Pattern "glob-ns-b/glob-svc-b" — slashed, matched against the composite identity.
        // A different namespace with the same service name must remain visible.
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "glob-ns-b/glob-svc-b",
            },
        };
        using var client = factory.CreateClient();

        // Excluded namespace+service: seeded directly into the DB (POST would return 403).
        await SeedExcludedEventAsync(
            service: "glob-svc-b",
            @namespace: "glob-ns-b",
            happenedAt: "2024-02-02T10:00:00Z");

        // Same service, different namespace — POST is permitted (pattern mismatch).
        await IngestAsync(client, service: "glob-svc-b", @namespace: "other-ns",
            happenedAt: "2024-02-02T11:00:00Z");

        var res = await client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
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

    // ── (c) Wildcard composite */svc — matches service under any namespace ──────

    [Fact]
    public async Task GlobCoverage_WildcardComposite_MatchesServiceUnderAnyNamespace()
    {
        // Pattern "*/glob-svc-c" — slashed (contains '/'), so matched against the composite
        // identity "namespace/service". The '*' spans '/', but the leading segment requires
        // a namespace to be present. The same service without a namespace is NOT excluded
        // (its identity is just "glob-svc-c" — no slash, pattern won't match).
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "*/glob-svc-c",
            },
        };
        using var client = factory.CreateClient();

        // Excluded: service under two different namespaces — seeded directly (POST 403).
        await SeedExcludedEventAsync(
            service: "glob-svc-c",
            @namespace: "ns-alpha",
            happenedAt: "2024-02-03T10:00:00Z");
        await SeedExcludedEventAsync(
            service: "glob-svc-c",
            @namespace: "ns-beta",
            happenedAt: "2024-02-03T10:01:00Z");

        // Visible: different service under a namespace — POST is permitted.
        await IngestAsync(client, service: "glob-svc-c-safe", @namespace: "ns-alpha",
            happenedAt: "2024-02-03T11:00:00Z");

        var res = await client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        var excludedRows = items.Where(e =>
            e.TryGetProperty("service", out var svc) &&
            svc.GetString() == "glob-svc-c").ToList();

        // All rows for "glob-svc-c" (regardless of namespace) must be gone.
        Assert.Empty(excludedRows);

        // The safe service must still appear.
        var visibleRow = items.FirstOrDefault(e =>
            e.TryGetProperty("service", out var svc) &&
            svc.GetString() == "glob-svc-c-safe");
        Assert.NotEqual(default, visibleRow);
    }

    // ── (d) Namespace that itself contains a slash ─────────────────────────────

    /// <summary>
    /// Namespace <c>acme/api</c>, service <c>checkout</c>; the composite identity is
    /// <c>acme/api/checkout</c>. Verifies three pattern forms that must each exclude it:
    /// <list type="bullet">
    ///   <item><c>acme/api/checkout</c> — full literal composite match.</item>
    ///   <item><c>acme/*</c> — <c>'*'</c> spans <c>'/'</c>, so it matches the three-segment identity.</item>
    ///   <item><c>checkout</c> (slashless) — matched against service name only, namespace irrelevant.</item>
    /// </list>
    /// </summary>
    [Theory]
    [InlineData("acme/api/checkout", "Full literal composite match excludes acme/api checkout")]
    [InlineData("acme/*", "Star-spans-slash wildcard excludes acme/api checkout")]
    [InlineData("checkout", "Slashless pattern excludes checkout regardless of namespace")]
    public async Task GlobCoverage_NamespaceWithSlash_PatternExcludesCompositeIdentity(
        string excludePattern, string _reason)
    {
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = excludePattern,
            },
        };
        using var client = factory.CreateClient();

        // Excluded: namespace "acme/api" contains a slash; identity = "acme/api/checkout".
        // POST is rejected (matches all three patterns); seed directly into DB.
        await SeedExcludedEventAsync(
            service: "checkout",
            @namespace: "acme/api",
            happenedAt: "2024-02-04T10:00:00Z");

        // Visible control: service "billing" under namespace "globex/web"
        // (identity "globex/web/billing"). This is NOT matched by any of the three
        // patterns under test:
        //   "acme/api/checkout" — literal mismatch on every segment.
        //   "acme/*"            — requires prefix "acme/"; "globex/web/billing" does not start with it.
        //   "checkout"          — slashless, matched against service name only; "billing" ≠ "checkout".
        // POST is permitted for all three patterns.
        await IngestAsync(client, service: "billing", @namespace: "globex/web",
            happenedAt: "2024-02-04T11:00:00Z");

        // For the composite-exact pattern only, ALSO assert that a same-namespace
        // different-service event stays visible — "acme/api/billing" does not match
        // the literal "acme/api/checkout".
        if (excludePattern == "acme/api/checkout")
        {
            await IngestAsync(client, service: "billing", @namespace: "acme/api",
                happenedAt: "2024-02-04T11:30:00Z");
        }

        var res = await client.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        // "checkout" under "acme/api" must be absent for every pattern.
        var hiddenRow = items.FirstOrDefault(e =>
            e.TryGetProperty("service", out var svc) && svc.GetString() == "checkout" &&
            e.TryGetProperty("namespace", out var ns) && ns.GetString() == "acme/api");
        Assert.Equal(default, hiddenRow);

        // "billing" under "globex/web" must be present — valid control for all three patterns.
        var visibleRow = items.FirstOrDefault(e =>
            e.TryGetProperty("service", out var svc) && svc.GetString() == "billing" &&
            e.TryGetProperty("namespace", out var ns) && ns.GetString() == "globex/web");
        Assert.NotEqual(default, visibleRow);

        // For the composite-exact pattern, also assert the same-namespace different-service
        // event is visible ("acme/api/billing" does not match "acme/api/checkout").
        if (excludePattern == "acme/api/checkout")
        {
            var sameNsVisibleRow = items.FirstOrDefault(e =>
                e.TryGetProperty("service", out var svc) && svc.GetString() == "billing" &&
                e.TryGetProperty("namespace", out var ns) && ns.GetString() == "acme/api");
            Assert.NotEqual(default, sameNsVisibleRow);
        }
    }

    [Fact]
    public async Task GlobCoverage_NamespaceWithSlash_SlashlessCheckoutPatternAlsoBlocksPost()
    {
        // Slashless "checkout" → matched against service name only.
        // POST for service="checkout", namespace="acme/api" must return 403.
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "checkout",
            },
        };
        using var client = factory.CreateClient();

        var res = await PostAsync(client, service: "checkout", @namespace: "acme/api");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);

        // Unrelated service is still permitted.
        var okRes = await PostAsync(client, service: "billing", @namespace: "acme/api");
        Assert.Equal(HttpStatusCode.Created, okRes.StatusCode);
    }

    // ── POST 403 with composite pattern (write-side spot check) ──────────────

    [Fact]
    public async Task GlobCoverage_CompositePattern_PostReturns403ForMatchingService()
    {
        // Pattern "glob-ns-e/glob-svc-e" — composite, two-segment.
        using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["SERVICE_EXCLUDE"] = "glob-ns-e/glob-svc-e",
            },
        };
        using var client = factory.CreateClient();

        var res = await PostAsync(client, service: "glob-svc-e", @namespace: "glob-ns-e");
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Inserts a <see cref="DeploymentEvent"/> row directly into the database via EF Core,
    /// bypassing the write endpoint. Used for excluded services that the API correctly
    /// rejects with 403 on POST. Represents events stored before SERVICE_EXCLUDE was set.
    /// </summary>
    private async Task SeedExcludedEventAsync(
        string service,
        string? @namespace,
        string happenedAt,
        string environment = "prod",
        string status = "success")
    {
        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .Options;
        await using var db = new DashboardDbContext(opts);

        db.DeploymentEvents.Add(new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"seed-{Guid.NewGuid():N}",
            Service = service,
            Namespace = @namespace,
            Environment = environment,
            Status = status,
            HappenedAt = DateTimeOffset.Parse(happenedAt),
        });
        await db.SaveChangesAsync();
    }

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
