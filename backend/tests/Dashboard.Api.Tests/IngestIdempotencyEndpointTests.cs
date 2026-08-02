using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for idempotent ingest behaviour introduced by the
/// <c>ux_de_dedup_natural_key</c> unique index (PR #407 prevention fix).
///
/// Verifies the full API contract:
/// <list type="bullet">
///   <item>First POST returns <c>201 Created</c>.</item>
///   <item>Identical body POSTed again returns <c>200 OK</c> with the pre-existing event body.</item>
///   <item>No SSE <c>deployment</c> frame is emitted for the duplicate.</item>
/// </list>
///
/// Requires a Postgres container (Testcontainers / Docker) — CI-only.
/// </summary>
[Collection("api-postgres")]
public sealed class IngestIdempotencyEndpointTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public IngestIdempotencyEndpointTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString);
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Unique deployment_id per test instance; other fields constant so the triple is reproducible.</summary>
    private readonly object _payload = new
    {
        deployment_id = $"gh-idem-{Guid.NewGuid():N}",
        service = "idem-svc",
        environment = "prod",
        status = "success",
        happened_at = "2026-06-15T10:00:00Z",
    };

    private HttpRequestMessage BuildPost() =>
        new(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(_payload),
            Headers = { { "X-Api-Key", TestApiFactory.TestApiKey } },
        };

    // ── 201 on first POST ─────────────────────────────────────────────────────

    [Fact]
    public async Task Post_FirstTime_Returns201()
    {
        var res = await _client.SendAsync(BuildPost());
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
    }

    // ── 200 on duplicate POST ────────────────────────────────────────────────

    [Fact]
    public async Task Post_IdenticalBody_Returns200WithExistingEventBody()
    {
        // First POST: creates the row.
        var res1 = await _client.SendAsync(BuildPost());
        Assert.Equal(HttpStatusCode.Created, res1.StatusCode);
        var body1 = await res1.Content.ReadFromJsonAsync<JsonElement>();
        var originalId = body1.GetProperty("id").GetString()!;

        // Second POST: exact same body → should be idempotent.
        var res2 = await _client.SendAsync(BuildPost());

        Assert.Equal(HttpStatusCode.OK, res2.StatusCode);

        var body2 = await res2.Content.ReadFromJsonAsync<JsonElement>();
        var returnedId = body2.GetProperty("id").GetString()!;

        // The duplicate response must carry the ORIGINAL event's id, not a new one.
        Assert.Equal(originalId, returnedId);
    }

    [Fact]
    public async Task Post_IdenticalBody_DatabaseContainsExactlyOneRow()
    {
        // Two identical POSTs must produce exactly one database row.
        await _client.SendAsync(BuildPost());
        await _client.SendAsync(BuildPost());

        // Verify via GET /api/deployments filtered to the unique service.
        var res = await _client.GetAsync("/api/deployments?service=idem-svc");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        var items = body.GetProperty("items").EnumerateArray().ToList();

        // Exactly one row — dedup worked.
        Assert.Equal(1, items.Count);
    }
}

/// <summary>
/// Verifies that no SSE <c>deployment</c> frame is emitted for a duplicate ingest.
/// Uses <see cref="TestApiFactory.UseRealNotifier"/> = true so the full
/// ingest → pg_notify → broadcaster → SSE fan-out path is exercised.
///
/// Requires a Postgres container — CI-only.
/// </summary>
[Collection("api-postgres")]
public sealed class IngestIdempotencySseTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private TestApiFactory _factory = null!;
    private HttpClient _client = null!;

    public IngestIdempotencySseTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();
        _factory = new TestApiFactory(_fixture.ConnectionString) { UseRealNotifier = true };
        _client = _factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _factory.DisposeAsync();
    }

    // ── No SSE frame for duplicate ────────────────────────────────────────────

    /// <summary>
    /// First POST → SSE frame arrives.  Duplicate POST → NO second SSE frame within
    /// a 3-second observation window.  Verifies that <see cref="IDeploymentIngestService"/>
    /// suppresses the notification on duplicate (the notifier is not called a second time).
    /// </summary>
    [Fact]
    public async Task Post_IdenticalBody_NoNewSseFrameForDuplicate()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        // Use a unique service name scoped to this test instance so other concurrent tests
        // do not accidentally deliver frames to our SSE stream.
        var service = $"idem-sse-{Guid.NewGuid():N}";
        var payload = new
        {
            deployment_id = $"gh-idem-sse-{Guid.NewGuid():N}",
            service,
            environment = "prod",
            status = "success",
            happened_at = "2026-06-15T12:00:00Z",
        };

        // Open SSE stream filtered to our unique service.
        var sseRequest = new HttpRequestMessage(
            HttpMethod.Get, $"/api/events/stream?service={service}");
        using var sseResponse = await _client.SendAsync(
            sseRequest, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, sseResponse.StatusCode);

        await using var stream = await sseResponse.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(stream);

        // Track all received event IDs on the stream.
        var receivedIds = new List<string>();
        var firstFrameArrived = new TaskCompletionSource<string>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var readTask = Task.Run(async () =>
        {
            while (!cts.IsCancellationRequested)
            {
                string? line;
                try { line = await reader.ReadLineAsync(cts.Token); }
                catch (OperationCanceledException) { break; }

                if (line is null) break;
                if (!line.StartsWith("data: ")) continue;

                // The SSE stream is already filtered by ?service={service} in the URL,
                // so every data frame belongs to this test's unique service.
                var json = JsonSerializer.Deserialize<JsonElement>(line[6..]);
                var id = json.GetProperty("id").GetString()!;
                receivedIds.Add(id);
                firstFrameArrived.TrySetResult(id);
            }
        }, cts.Token);

        // Allow subscription to register before ingesting.
        await Task.Delay(300, cts.Token);

        // POST 1 — new row; notifier fires; SSE frame expected.
        var msg1 = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg1.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res1 = await _client.SendAsync(msg1, cts.Token);
        Assert.Equal(HttpStatusCode.Created, res1.StatusCode);

        // Wait for the first SSE frame to confirm the live path is working.
        await firstFrameArrived.Task.WaitAsync(cts.Token);

        // POST 2 — duplicate; notifier must NOT fire; no second SSE frame.
        var msg2 = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg2.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);
        var res2 = await _client.SendAsync(msg2, cts.Token);
        Assert.Equal(HttpStatusCode.OK, res2.StatusCode);

        // Wait 3 s for any leaked notification to propagate.
        await Task.Delay(3000, cts.Token);

        cts.Cancel();
        try { await readTask; } catch (OperationCanceledException) { }

        // Exactly one SSE frame must have arrived for this service.
        Assert.Equal(1, receivedIds.Count);
    }
}
