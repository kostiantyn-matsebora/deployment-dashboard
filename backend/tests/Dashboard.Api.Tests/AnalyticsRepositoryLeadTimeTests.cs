using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Dashboard.Api.Tests.Helpers;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for lead-time terminal-redirection behaviour in
/// <c>AnalyticsRepository.GetLeadTimeHourSamplesAsync</c>, exercised end-to-end via
/// <c>GET /api/analytics/dora</c> against a real Postgres container (Testcontainers).
///
/// These tests close the coverage gap left by the SQLite-based
/// <c>Dashboard.Read.Tests.AnalyticsRepositoryTests</c>: EF Core cannot translate
/// <c>Array.Any()</c> on the <c>text[]</c> <c>parent_deployments</c> column when using
/// the SQLite CSV value-converter.  On Postgres the native array type translates correctly.
///
/// <c>ANALYTICS_FUNNEL_ENVIRONMENTS</c> is injected at composition-root time via
/// <see cref="TestApiFactory.ExtraConfiguration"/>, exercising the real
/// <c>ReadServiceExtensions.AddReadServices</c> → <c>AnalyticsFunnelEnvironments.Parse</c>
/// → <c>AnalyticsOptions</c> singleton path.
///
/// Timing note: the DORA endpoint uses Day granularity by default, so <c>to</c> is
/// truncated to today's UTC midnight — events seeded for "today" fall outside the window.
/// Seeds use fixed offsets from UTC yesterday (3 days ago for safety) so they always
/// land inside the 7-day window regardless of when in the day the test runs.
///
/// Coverage:
/// LT-A  Custom ladder dev→staging→production: lead_time.value is positive when a parent
///        chain reaching "production" exists — terminal is "production", not "prod".
/// LT-B  Case-insensitive terminal: ANALYTICS_FUNNEL_ENVIRONMENTS="dev,staging,PRODUCTION"
///        (uppercase) with DB env "production" lowercase → lead_time.value still positive.
/// LT-C  Negative: no terminal events → lead_time.value is null.
/// LT-D  Terminal mismatch guard: events exist in "prod" (old default) but ladder terminal
///        "production" → lead_time.value null (no false positives from the old default name).
/// </summary>
[Collection("api-postgres")]
public sealed class AnalyticsRepositoryLeadTimeTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;

    // Anchor events 3 days ago (UTC) so they fall safely inside the 7-day window.
    // window.to = today's UTC midnight; 3 days ago is well within [to - 7d, to).
    // Use explicit UTC offset so the value is not influenced by the local machine timezone
    // (DateTimeOffset.UtcNow.Date returns DateTime Kind=Unspecified; implicit DateTimeOffset
    // conversion would apply local offset, producing a non-UTC timestamp that Npgsql may
    // reject when the timestamptz column expects UTC-normalized input).
    // Parent is 2 h before terminal → ~2 h lead-time sample.
    private static readonly DateTimeOffset TerminalAt =
        new(DateTime.UtcNow.Date.AddDays(-3).AddHours(12), TimeSpan.Zero);
    private static readonly DateTimeOffset ParentAt = TerminalAt.AddHours(-2);

    public AnalyticsRepositoryLeadTimeTests(PostgresFixture fixture) => _fixture = fixture;

    public Task InitializeAsync() => _fixture.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    // ── LT-A: Custom ladder — terminal is "production", not "prod" ────────────

    /// <summary>
    /// Ladder "dev,staging,production".
    /// Seed a "production" terminal event with parent_deployments pointing at a "dev" parent.
    /// GET /api/analytics/dora?window=7d must return lead_time.value &gt; 0.
    /// </summary>
    [Fact]
    public async Task Dora_CustomLadderProduction_LeadTimePositiveWhenParentChainExists()
    {
        var parentId = $"lt-a-parent-{Guid.NewGuid():N}";

        await using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["ANALYTICS_FUNNEL_ENVIRONMENTS"] = "dev,staging,production",
            },
        };

        var client = factory.CreateClient();
        await IngestAsync(client, parentId, "lt-a-svc", "dev",
            "success", ParentAt, parentDeployments: null);
        await IngestAsync(client, $"lt-a-terminal-{Guid.NewGuid():N}", "lt-a-svc", "production",
            "success", TerminalAt, parentDeployments: [parentId]);

        var response = await client.GetAsync("/api/analytics/dora?window=7d");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        var ltValue = body.GetProperty("lead_time").GetProperty("value");
        Assert.False(ltValue.ValueKind == JsonValueKind.Null,
            "lead_time.value must not be null — expected a positive sample from the parent chain.");
        Assert.True(ltValue.GetDouble() > 0,
            $"lead_time.value must be positive, got {ltValue.GetDouble()}.");
    }

    // ── LT-B: Case-insensitive terminal ───────────────────────────────────────

    /// <summary>
    /// ANALYTICS_FUNNEL_ENVIRONMENTS="dev,staging,PRODUCTION" (uppercase PRODUCTION).
    /// AnalyticsFunnelEnvironments.Parse normalizes to "production".
    /// DB stores lowercase "production".
    /// FetchProdTerminalWithParentsAsync uses LOWER(e.Environment) == "production" → match.
    /// </summary>
    [Fact]
    public async Task Dora_UpperCaseConfigTerminal_LeadTimePositive()
    {
        var parentId = $"lt-b-parent-{Guid.NewGuid():N}";

        await using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // PRODUCTION (uppercase) must be normalized to "production" by Parse.
                ["ANALYTICS_FUNNEL_ENVIRONMENTS"] = "dev,staging,PRODUCTION",
            },
        };

        var client = factory.CreateClient();
        await IngestAsync(client, parentId, "lt-b-svc", "dev",
            "success", ParentAt, parentDeployments: null);
        await IngestAsync(client, $"lt-b-terminal-{Guid.NewGuid():N}", "lt-b-svc", "production",
            "success", TerminalAt, parentDeployments: [parentId]);

        var response = await client.GetAsync("/api/analytics/dora?window=7d");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ltValue = body.GetProperty("lead_time").GetProperty("value");

        Assert.False(ltValue.ValueKind == JsonValueKind.Null,
            "PRODUCTION (uppercase config) must match lowercase 'production' in DB via LOWER() normalization.");
        Assert.True(ltValue.GetDouble() > 0);
    }

    // ── LT-C: Negative — no terminal events ───────────────────────────────────

    /// <summary>
    /// Ladder "dev,staging,production" but only "dev" events seeded — no "production" terminal.
    /// GetLeadTimeHourSamplesAsync returns empty → lead_time.value must be null.
    /// </summary>
    [Fact]
    public async Task Dora_CustomLadder_NoTerminalEvents_LeadTimeNull()
    {
        await using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                ["ANALYTICS_FUNNEL_ENVIRONMENTS"] = "dev,staging,production",
            },
        };

        var client = factory.CreateClient();
        // Seed only "dev" events — no "production" terminal.
        await IngestAsync(client, $"lt-c-dep-{Guid.NewGuid():N}", "lt-c-svc", "dev",
            "success", ParentAt, parentDeployments: null);

        var response = await client.GetAsync("/api/analytics/dora?window=7d");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ltValue = body.GetProperty("lead_time").GetProperty("value");

        Assert.Equal(JsonValueKind.Null, ltValue.ValueKind);
    }

    // ── LT-D: Terminal mismatch guard ────────────────────────────────────────

    /// <summary>
    /// Ladder terminal "production"; events seeded under "prod" (old default name).
    /// FetchProdTerminalWithParentsAsync looks for LOWER(e.Environment) == "production" —
    /// "prod" must NOT match → lead_time.value null (no false positives from old default).
    /// </summary>
    [Fact]
    public async Task Dora_TerminalMismatch_OldProdNameNotPickedUp_LeadTimeNull()
    {
        var parentId = $"lt-d-parent-{Guid.NewGuid():N}";

        await using var factory = new TestApiFactory(_fixture.ConnectionString)
        {
            ExtraConfiguration = new Dictionary<string, string?>
            {
                // terminal = "production"; DB will have "prod" → must NOT match
                ["ANALYTICS_FUNNEL_ENVIRONMENTS"] = "dev,staging,production",
            },
        };

        var client = factory.CreateClient();
        await IngestAsync(client, parentId, "lt-d-svc", "dev",
            "success", ParentAt, parentDeployments: null);
        await IngestAsync(client, $"lt-d-prod-{Guid.NewGuid():N}", "lt-d-svc", "prod",
            "success", TerminalAt, parentDeployments: [parentId]);

        var response = await client.GetAsync("/api/analytics/dora?window=7d");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        var ltValue = body.GetProperty("lead_time").GetProperty("value");

        Assert.Equal(JsonValueKind.Null, ltValue.ValueKind);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static async Task IngestAsync(
        HttpClient client,
        string deploymentId,
        string service,
        string environment,
        string status,
        DateTimeOffset happenedAt,
        string[]? parentDeployments)
    {
        var payload = new Dictionary<string, object?>
        {
            ["deployment_id"] = deploymentId,
            ["service"]       = service,
            ["environment"]   = environment,
            ["status"]        = status,
            ["happened_at"]   = happenedAt.ToString("O"),
        };

        if (parentDeployments is { Length: > 0 })
            payload["parent_deployments"] = parentDeployments;

        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(payload),
        };
        msg.Headers.Add("X-Api-Key", TestApiFactory.TestApiKey);

        var res = await client.SendAsync(msg);
        res.EnsureSuccessStatusCode();
    }
}
