using System.Net;
using Dashboard.Fetcher.Adapters.GitHubActions;
using Dashboard.Fetcher.DependencyInjection;
using Dashboard.Fetcher.Tests.Support;
using Dashboard.Shared.Domain;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// CR-0009 + ADR-0004 — coverage for the MVP <see cref="GitHubActionsAdapter"/>.
/// Exercises every documented response path (happy / empty / paginated /
/// rate-limited / auth-failure) through a stubbed <see cref="IHttpClientFactory"/>
/// so the contract is locked without spinning up real HTTP.
/// </summary>
public sealed class GitHubActionsAdapterTests
{
    private const string BaseUrl = "https://api.github.com/";

    private static (GitHubActionsAdapter adapter, StubHttpHandler handler) Build()
    {
        var handler = new StubHttpHandler();
        var factory = new StubHttpClientFactory();
        factory.Register(GitHubActionsAdapter.HttpClientName, handler, BaseUrl);
        var adapter = new GitHubActionsAdapter(factory, NullLogger<GitHubActionsAdapter>.Instance);
        return (adapter, handler);
    }

    private static bool IsDeploymentsList(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.EndsWith("/deployments", StringComparison.Ordinal);

    private static bool IsDeploymentStatus(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/deployments/", StringComparison.Ordinal)
        && req.RequestUri.AbsolutePath.EndsWith("/statuses", StringComparison.Ordinal);

    // ──────────────────────────────────────────────────────────────────────
    // Happy path
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_HappyPath_TwoDeployments_TwoStatuses_ReturnsTwoEvents_AndAdvancesCursor()
    {
        var (adapter, handler) = Build();

        // Two deployments, both above the watermark "0". Newest-first per GHA convention.
        const string listJson = """
        [
          {"id": 101, "sha": "aaaaaaa1111111111111111111111111111111aa", "ref": "main",
           "environment": "prod", "created_at": "2026-05-18T10:00:00Z",
           "creator": {"login": "alice"}},
          {"id": 100, "sha": "bbbbbbb2222222222222222222222222222222bb", "ref": "main",
           "environment": "dev",  "created_at": "2026-05-18T09:00:00Z",
           "creator": {"login": "bob"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // Per-deployment status fetch — return success for both.
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/o/r/runs/1\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Equal(2, page.Events.Count);
        // Cursor = max deployment.id seen in the page (101).
        Assert.Equal("101", page.NewCursor);
        // Two deployments returned, ceiling = perPage(50) → not full → HasMore = false.
        Assert.False(page.HasMore);

        // Events emitted chronological (ascending by id) — deployment 100 first, 101 second.
        Assert.Equal("gha-100", page.Events[0].DeploymentId);
        Assert.Equal("gha-101", page.Events[1].DeploymentId);
        Assert.Equal("svc", page.Events[0].Service);                 // sourceId tail
        Assert.Equal(DeploymentStatus.Success, page.Events[0].Status);
        // sha truncated to first 7 chars when present (matches adapter convention)
        Assert.Equal("bbbbbbb", page.Events[0].Version);
        Assert.Equal("dev", page.Events[0].Environment);
        Assert.Equal("prod", page.Events[1].Environment);
        Assert.Equal("bob", page.Events[0].Actor);
        Assert.Equal("alice", page.Events[1].Actor);
    }

    [Fact]
    public async Task FetchPage_Empty_ReturnsEmptyPage_DoesNotAdvanceCursor()
    {
        var (adapter, handler) = Build();
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, "[]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: "42", pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        // Cursor passes through verbatim when the API has nothing new.
        Assert.Equal("42", page.NewCursor);
        Assert.False(page.HasMore);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Pagination
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_FullPage_SignalsHasMoreTrue()
    {
        var (adapter, handler) = Build();
        var pageSize = 3;

        // Three deployments — equal to pageSize → adapter must surface HasMore=true.
        const string listJson = """
        [
          {"id": 30, "sha": "deadbeefcafebabe1234567890", "ref": "main",
           "environment": "prod", "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "u3"}},
          {"id": 29, "sha": "feedfacebadc0ffee123456789", "ref": "main",
           "environment": "prod", "created_at": "2026-05-18T09:00:00Z", "creator": {"login": "u2"}},
          {"id": 28, "sha": "1234567890abcdef1234567890", "ref": "main",
           "environment": "prod", "created_at": "2026-05-18T08:00:00Z", "creator": {"login": "u1"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"in_progress\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: pageSize, CancellationToken.None);

        Assert.Equal(3, page.Events.Count);
        Assert.True(page.HasMore, "deployments.Count >= perPage → HasMore must be true");
        Assert.Equal("30", page.NewCursor);
        // GHA "in_progress" / "queued" / "pending" → DeploymentStatus.InProgress
        Assert.All(page.Events, e => Assert.Equal(DeploymentStatus.InProgress, e.Status));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Rate limits (deviation 4: cursor MUST NOT advance on rate-limit hits)
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_RateLimited_403_With_XRateLimitRemainingZero_ReturnsEmpty_PreservesCursor()
    {
        var (adapter, handler) = Build();

        handler.When(IsDeploymentsList, () =>
        {
            var resp = new HttpResponseMessage(HttpStatusCode.Forbidden);
            resp.Headers.TryAddWithoutValidation("X-RateLimit-Remaining", "0");
            resp.Headers.TryAddWithoutValidation("X-RateLimit-Reset", "1747584000");
            return resp;
        });

        var page = await adapter.FetchPageAsync("acme/svc", cursor: "999", pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        Assert.Equal("999", page.NewCursor);     // cursor preserved verbatim
        Assert.False(page.HasMore);
    }

    [Fact]
    public async Task FetchPage_RateLimited_429_ReturnsEmpty_PreservesCursor()
    {
        var (adapter, handler) = Build();
        handler.When(IsDeploymentsList, () =>
        {
            var resp = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            resp.Headers.TryAddWithoutValidation("Retry-After", "60");
            return resp;
        });

        var page = await adapter.FetchPageAsync("acme/svc", cursor: "777", pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        Assert.Equal("777", page.NewCursor);
        Assert.False(page.HasMore);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Auth failure
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_AuthFailure_401_ReturnsEmpty_PreservesCursor()
    {
        var (adapter, handler) = Build();
        // 401 without X-RateLimit-Remaining: NOT rate-limited but error path.
        handler.WhenStatus(IsDeploymentsList, HttpStatusCode.Unauthorized);

        var page = await adapter.FetchPageAsync("acme/svc", cursor: "555", pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        Assert.Equal("555", page.NewCursor);
        Assert.False(page.HasMore);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Mapping correctness — additional state mappings
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_StatusFailureAndError_MapToFailureLifecycle()
    {
        var (adapter, handler) = Build();
        const string listJson = """
        [
          {"id": 12, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}},
          {"id": 11, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T09:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // First status call → failure, second → error. (matchers fire in registration order, EnqueueOnce gives FIFO)
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"failure\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T09:01:00Z\"}]"));
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"error\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]"));

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Equal(2, page.Events.Count);
        Assert.All(page.Events, e => Assert.Equal(DeploymentStatus.Failure, e.Status));
    }

    [Fact]
    public async Task FetchPage_NoStatuses_DefaultsToInProgress()
    {
        var (adapter, handler) = Build();
        const string listJson = """
        [
          {"id": 1, "sha": "abc", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK, "[]"); // no statuses yet

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Single(page.Events);
        Assert.Equal(DeploymentStatus.InProgress, page.Events[0].Status);
    }

    // ──────────────────────────────────────────────────────────────────────
    // source-id contract — multi-slash / malformed gets dropped
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FetchPage_MalformedSourceId_Returns_EmptyPage_NoHttpCall()
    {
        var (adapter, handler) = Build();
        // No matcher registered — would throw if any HTTP call was made.
        var page = await adapter.FetchPageAsync("not-a-repo-path", cursor: "9", pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        Assert.Equal("9", page.NewCursor);
        Assert.False(page.HasMore);
        Assert.Empty(handler.Requests);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Cursor watermark filtering — events at or below the cursor are dropped
    // ──────────────────────────────────────────────────────────────────────

    // ──────────────────────────────────────────────────────────────────────
    // Cursor parse-graceful-fallback — malformed cursor must be treated as
    // "no prior cursor" (watermark = 0). Verified through observable adapter
    // behaviour because GitHubActionsCursor is internal to the library
    // (role boundary: tests do not modify production source to add
    // InternalsVisibleTo).
    // ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("")]
    [InlineData("not-a-number")]
    [InlineData("-5")]
    [InlineData("3.14")]
    public async Task FetchPage_MalformedCursor_TreatedAsZero_AndAllDeploymentsAreFresh(string brokenCursor)
    {
        var (adapter, handler) = Build();
        const string listJson = """
        [
          {"id": 5, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: brokenCursor, pageSize: 50, CancellationToken.None);

        // With cursor parsed as 0, the id=5 deployment is strictly above the
        // watermark and is therefore emitted (proving the parse-fail → 0
        // fallback that GitHubActionsCursor.Parse documents).
        Assert.Single(page.Events);
        Assert.Equal("5", page.NewCursor);
    }

    [Fact]
    public async Task FetchPage_NullCursor_FormatsZero_WhenEverythingIsFiltered()
    {
        var (adapter, handler) = Build();
        // Page is non-empty (so the cursor format branch runs) but every entry
        // sits at/below the parsed cursor → fresh list is empty → adapter
        // formats the unchanged watermark.
        const string listJson = """
        [
          {"id": 0, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK, "[]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Empty(page.Events);
        Assert.Equal("0", page.NewCursor);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Anonymous-mode authorization — placeholder / empty / null / whitespace
    // tokens MUST omit the Authorization header; real PAT MUST send Bearer.
    // Verifies the ConfigureGitHubAuthorization chokepoint in
    // ServiceCollectionExtensions, applied per-client at HttpClient build.
    // ──────────────────────────────────────────────────────────────────────

    /// <summary>
    /// IHttpClientFactory shim that mirrors the production composition root:
    /// builds an HttpClient over the stub handler with base URL + UA + Accept
    /// + X-GitHub-Api-Version + token-aware Authorization. Production wires
    /// the same config via <see cref="ServiceCollectionExtensions.AddCiCdFetcher"/>;
    /// here we apply <see cref="ServiceCollectionExtensions.ConfigureGitHubAuthorization"/>
    /// directly so the test exercises the chokepoint without spinning up DI.
    /// </summary>
    private sealed class AuthConfiguringFactory : IHttpClientFactory
    {
        private readonly StubHttpHandler _handler;
        private readonly string? _token;

        public AuthConfiguringFactory(StubHttpHandler handler, string? token)
        {
            _handler = handler;
            _token = token;
        }

        public HttpClient CreateClient(string name)
        {
            var http = new HttpClient(_handler, disposeHandler: false)
            {
                BaseAddress = new Uri(BaseUrl),
            };
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            http.DefaultRequestHeaders.UserAgent.ParseAdd("dashboard-fetcher/0.1");
            http.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            ServiceCollectionExtensions.ConfigureGitHubAuthorization(http, _token);
            return http;
        }
    }

    private static (GitHubActionsAdapter adapter, StubHttpHandler handler) BuildWithToken(string? token)
    {
        var handler = new StubHttpHandler();
        var factory = new AuthConfiguringFactory(handler, token);
        var adapter = new GitHubActionsAdapter(factory, NullLogger<GitHubActionsAdapter>.Instance);
        return (adapter, handler);
    }

    private static void SeedSingleDeploymentWithSuccessStatus(StubHttpHandler handler)
    {
        const string listJson = """
        [
          {"id": 7, "sha": "deadbee", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]");
    }

    [Fact]
    public async Task FetchPage_AuthedMode_RealToken_SendsBearerOnListAndStatus()
    {
        const string token = "ghp_xxxxx";
        var (adapter, handler) = BuildWithToken(token);
        SeedSingleDeploymentWithSuccessStatus(handler);

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Single(page.Events);
        // Two requests: list + status. Both MUST carry Authorization: Bearer <token>.
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, req =>
        {
            Assert.True(req.Headers.TryGetValue("Authorization", out var auth),
                $"Authed mode must send Authorization on {req.Method} {req.Uri}");
            Assert.Equal($"Bearer {token}", auth);
        });
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task FetchPage_AnonymousMode_EmptyOrNullOrWhitespaceToken_OmitsAuthorization(string? token)
    {
        var (adapter, handler) = BuildWithToken(token);
        SeedSingleDeploymentWithSuccessStatus(handler);

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Single(page.Events);
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, req =>
            Assert.False(req.Headers.ContainsKey("Authorization"),
                $"Anonymous mode (token={token ?? "null"}) must NOT send Authorization on {req.Method} {req.Uri}"));
    }

    [Fact]
    public async Task FetchPage_AnonymousMode_PlaceholderToken_OmitsAuthorization()
    {
        // Compose-default placeholder per install/docker-compose.release.yml —
        // adapter MUST treat as anonymous and omit Authorization entirely.
        var (adapter, handler) = BuildWithToken(ServiceCollectionExtensions.AnonymousTokenPlaceholder);
        SeedSingleDeploymentWithSuccessStatus(handler);

        var page = await adapter.FetchPageAsync("PostHog/posthog", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Single(page.Events);
        Assert.Equal(2, handler.Requests.Count);
        Assert.All(handler.Requests, req =>
            Assert.False(req.Headers.ContainsKey("Authorization"),
                $"Placeholder token must NOT send Authorization on {req.Method} {req.Uri}"));
    }

    [Fact]
    public async Task FetchPage_FiltersOutDeploymentsAtOrBelowWatermark()
    {
        var (adapter, handler) = Build();
        // Two deployments returned; only id=11 is strictly above cursor=10.
        const string listJson = """
        [
          {"id": 11, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}},
          {"id": 10, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T09:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:01:00Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: "10", pageSize: 50, CancellationToken.None);

        Assert.Single(page.Events);
        Assert.Equal("gha-11", page.Events[0].DeploymentId);
        Assert.Equal("11", page.NewCursor);
    }
}
