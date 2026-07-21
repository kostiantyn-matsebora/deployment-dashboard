using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Poll;

/// <summary>
/// Tests for the recover saga's cursor rewind (issue #423, §5.10.6) —
/// <see cref="GithubActionsAdapter.RewindTo"/>. Recover is non-destructive and must NEVER
/// re-enter backfill: the rewound cursor carries every configured repo's high-water mark set
/// to the resolved <c>since</c>, with no backfill markers, so the next
/// <see cref="GithubActionsAdapter.FetchAsync"/> call takes the incremental
/// <c>PollAsync</c> branch (distinguishable from backfill because only backfill calls
/// <c>/environments</c> — see <c>TerminalCachePollTests.EmptyCursor_TakesBackfillPath_NotIncrementalPoll</c>
/// for the inverse assertion).
/// </summary>
public sealed class RecoverRewindPollTests
{
    private const string OwnerA = "acme";
    private const string RepoA = "api";
    private const string FullRepoA = $"{OwnerA}/{RepoA}";

    private const string OwnerB = "acme";
    private const string RepoB = "web";
    private const string FullRepoB = $"{OwnerB}/{RepoB}";

    private const long RunId = 900L;

    // ── 1. RewindTo builds a cursor with since=T for every configured repo, no backfill ──

    [Fact]
    public void RewindTo_BuildsCursorWithSinceForEveryConfiguredRepo_NoBackfillMarkers()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        // RewindTo performs no HTTP I/O — a throwing handler proves that.
        var adapter = BuildAdapter(new ThrowingHandler(), repos: $"{FullRepoA},{FullRepoB}");

        var encoded = adapter.RewindTo(since);

        Assert.False(string.IsNullOrEmpty(encoded));
        var decoded = GithubCursor.Decode(encoded);

        Assert.Equal(since, decoded.Repos[FullRepoA].Since);
        Assert.Equal(since, decoded.Repos[FullRepoB].Since);
        Assert.False(decoded.IsBackfilling, "Recover rewind must carry no backfill markers.");
        Assert.False(decoded.IsEmpty, "A rewound cursor with high-water marks must not read as empty.");
    }

    [Fact]
    public void RewindTo_ReturnsNonNullNonEmptyCursor_SingleRepo()
    {
        var since = DateTimeOffset.UtcNow.AddDays(-1);
        var adapter = BuildAdapter(new ThrowingHandler(), repos: FullRepoA);

        var encoded = adapter.RewindTo(since);

        Assert.NotNull(encoded);
        Assert.NotEqual("", encoded);
        var decoded = GithubCursor.Decode(encoded);
        Assert.False(decoded.IsEmpty);
    }

    // ── 2. RewindTo clears dedup caches (same effect as ResetState) ──────────────

    /// <summary>
    /// Mirrors <c>TerminalCachePollTests.ResetState_ClearsTerminalCache…</c>: a deployment that
    /// went terminal in cycle 1 must have its statuses RE-fetched after
    /// <see cref="GithubActionsAdapter.RewindTo"/> — proving the recover rewind clears the same
    /// windowed dedup caches <see cref="GithubActionsAdapter.ResetState"/> clears, so a warm
    /// conditional-request hit doesn't reuse the narrow pre-rewind window and miss the gap.
    /// </summary>
    [Fact]
    public async Task RewindTo_ClearsTerminalCache_StatusesRefetchedOnNextPoll()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);

        var deployment = MakeDeployment(id: 1, daysAgo: 1);
        var successStatus = MakeStatus(deployId: 1, state: "success", runId: RunId, createdAt: since.AddMinutes(30));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [1] = [successStatus] },
            runId: RunId);

        var handler = new CountingFakeGithubHandler(urlMap);
        var adapter = BuildAdapter(handler, repos: FullRepoA);

        var cursor = new GithubCursor().WithRepo(FullRepoA, since).Encode();

        // Cycle 1: statuses fetched, deployment cached as terminal.
        await DrainPollAsync(adapter, cursor);
        var statusCallsAfterCycle1 = handler.StatusCalls(deploymentId: 1);
        Assert.True(statusCallsAfterCycle1 >= 1);

        // Recover rewind: since it targets the SAME window, the deployment falls in-window again.
        var rewound = adapter.RewindTo(since);

        // Cycle 2 with the rewound cursor: cache cleared → statuses re-fetched.
        var events2 = await DrainPollAsync(adapter, rewound);
        var statusCallsAfterCycle2 = handler.StatusCalls(deploymentId: 1);

        Assert.True(statusCallsAfterCycle2 > statusCallsAfterCycle1,
            $"RewindTo must clear the terminal cache so /statuses is re-fetched. " +
            $"Cycle1={statusCallsAfterCycle1}, Cycle2={statusCallsAfterCycle2}");
        Assert.Contains(events2, e => e.DeploymentId == "gh-deploy-1");
    }

    // ── 3. Next FetchAsync after RewindTo takes the incremental PollAsync branch ──

    [Fact]
    public async Task AfterRewindTo_NextFetchAsyncTakesIncrementalPollPath_NotBackfill()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-3);
        var deployment = MakeDeployment(id: 1, daysAgo: 1);
        var status = MakeStatus(deployId: 1, state: "success", runId: RunId, createdAt: since.AddMinutes(10));
        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [1] = [status] },
            runId: RunId);

        var handler = new CountingFakeGithubHandler(urlMap);
        var adapter = BuildAdapter(handler, repos: FullRepoA, backfill: false);

        var rewound = adapter.RewindTo(since);
        await DrainPollAsync(adapter, rewound);

        var envPath = $"/repos/{OwnerA}/{RepoA}/environments";
        Assert.True(handler.PathCalls(envPath) == 0,
            "Backfill (which lists /environments) must NEVER run after a recover rewind — " +
            "recovery stays on the incremental poll branch.");
    }

    // ── 4. BACKFILL=true guardrail: the rewind is discarded, backfill re-enters ──

    /// <summary>
    /// Documents the guardrail in <c>GithubActionsAdapter.RewindTo</c>: when the operator has
    /// left <c>BACKFILL=true</c> set, the rewound cursor is still returned/persisted correctly,
    /// but the very next <c>FetchAsync</c> re-enters backfill regardless (the flag dominates
    /// <c>shouldBackfill</c>), discarding the rewind. Recover requires <c>BACKFILL=false</c>
    /// to behave as the non-destructive incremental resume it is designed to be.
    /// </summary>
    [Fact]
    public async Task RewindTo_WithBackfillFlagTrue_NextFetchAsyncReEntersBackfill()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-1);
        var deployment = MakeDeployment(id: 1, daysAgo: 1);
        var status = MakeStatus(deployId: 1, state: "success", runId: RunId, createdAt: since.AddMinutes(5));
        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [1] = [status] },
            runId: RunId);

        var handler = new CountingFakeGithubHandler(urlMap);
        var adapter = BuildAdapter(handler, repos: FullRepoA, backfill: true);

        var rewound = adapter.RewindTo(since);
        await DrainPollAsync(adapter, rewound);

        var envPath = $"/repos/{OwnerA}/{RepoA}/environments";
        Assert.True(handler.PathCalls(envPath) >= 1,
            "With BACKFILL=true the guardrail is active: the rewind is discarded and the next " +
            "fetch re-enters backfill (which lists /environments).");
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static GhDeployment MakeDeployment(long id, int daysAgo) => new()
    {
        Id = id,
        Sha = $"sha{id:D4}",
        Ref = "main",
        Environment = "prod",
        CreatedAt = DateTimeOffset.UtcNow.AddDays(-daysAgo),
    };

    private static GhDeploymentStatus MakeStatus(
        long deployId, string state, long runId, DateTimeOffset createdAt) => new()
        {
            Id = deployId * 10,
            State = state,
            TargetUrl = $"https://github.com/{OwnerA}/{RepoA}/actions/runs/{runId}/jobs/1",
            CreatedAt = createdAt,
        };

    private static async Task<IReadOnlyList<Dashboard.Shared.Contracts.DeploymentEventIngest>> DrainPollAsync(
        GithubActionsAdapter adapter, string cursor)
    {
        var events = new List<Dashboard.Shared.Contracts.DeploymentEventIngest>();
        await foreach (var chunk in adapter.FetchAsync(cursor, CancellationToken.None))
            events.AddRange(chunk.Events);
        return events;
    }

    private static GithubActionsAdapter BuildAdapter(
        HttpMessageHandler handler, string repos, bool backfill = false)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };

        var rateLimitBudget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();

        var githubClient = new GithubClient(httpClient, rateLimitBudget);
        var graphCache = new WorkflowGraphCache();

        var adapterOptions = new GithubAdapterOptions
        {
            Repos = repos,
            VersionSource = "attribute:sha",
        };
        var fetcherOptions = new FetcherOptions
        {
            InitialLookback = TimeSpan.FromDays(7),
            Backfill = backfill,
        };
        var versionResolver = new VersionResolver(
            VersionSourceConfig.Default, graphCache, githubClient);
        var eventBuilder = new BackfillEventBuilder(
            githubClient, graphCache, versionResolver,
            WorkflowExcludeFilter.PassAll, NullLogger<BackfillEventBuilder>.Instance);
        var backfillRunner = new BackfillRunner(
            githubClient, adapterOptions, fetcherOptions,
            eventBuilder, NullLogger<BackfillRunner>.Instance);
        var statusEventMapper = new DeploymentStatusEventMapper(
            githubClient, graphCache, versionResolver,
            WorkflowExcludeFilter.PassAll, NullLogger<DeploymentStatusEventMapper>.Instance);

        return new GithubActionsAdapter(
            githubClient, adapterOptions, fetcherOptions,
            backfillRunner, statusEventMapper, NullLogger<GithubActionsAdapter>.Instance);
    }

    private const string WorkflowYaml = """
        name: Deploy API
        jobs:
          deploy-prod:
            environment: prod
            runs-on: ubuntu-latest
            steps: []
        """;

    private static Dictionary<string, object> BuildUrlMap(
        List<GhDeployment> deploymentsForWindow,
        Dictionary<long, List<GhDeploymentStatus>> statusesById,
        long runId)
    {
        var yamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(WorkflowYaml));
        var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{OwnerA}/{RepoA}/deployments"] = deploymentsForWindow,
            [$"/repos/{OwnerA}/{RepoA}/actions/runs/{runId}"] =
                new GhWorkflowRun { Id = runId, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc0001" },
            [$"/repos/{OwnerA}/{RepoA}/contents/.github/workflows/deploy.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };
        foreach (var (id, statuses) in statusesById)
            map[$"/repos/{OwnerA}/{RepoA}/deployments/{id}/statuses"] = statuses;

        // Backfill lists /environments — always present in the map so the BACKFILL=true
        // guardrail test can actually complete the backfill run rather than 404ing. The
        // per-env deployments listing (/deployments?environment=prod) is deliberately absent —
        // GetPagedAsync treats a 404 as "no items" (yield break, no throw), so the backfill run
        // still completes cleanly with zero events for that env.
        map[$"/repos/{OwnerA}/{RepoA}/environments"] =
            new GhEnvironmentListResponse { Environments = [new GhEnvironment { Name = "prod" }] };
        return map;
    }

    // ── fake HTTP handlers ────────────────────────────────────────────────────

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new InvalidOperationException(
                $"RewindTo must not perform HTTP I/O; unexpected request to {request.RequestUri}");
    }

    /// <summary>Records each URL path called; serves responses from <paramref name="urlMap"/>.</summary>
    private sealed class CountingFakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        private readonly List<string> _calls = [];

        public int StatusCalls(long deploymentId)
        {
            var suffix = $"/repos/{OwnerA}/{RepoA}/deployments/{deploymentId}/statuses";
            lock (_calls)
                return _calls.Count(c => StripSuffix(c).Equals(suffix, StringComparison.OrdinalIgnoreCase));
        }

        public int PathCalls(string suffix)
        {
            lock (_calls)
                return _calls.Count(c => StripSuffix(c).Equals(suffix, StringComparison.OrdinalIgnoreCase));
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";
            lock (_calls) _calls.Add(path);

            var lookup = StripSuffix(path);
            if (urlMap.TryGetValue(lookup, out var payload))
            {
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                });
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static string StripSuffix(string path)
        {
            var idx = path.IndexOf("&per_page=", StringComparison.Ordinal);
            if (idx >= 0) return path[..idx];
            idx = path.IndexOf("?per_page=", StringComparison.Ordinal);
            if (idx >= 0) return path[..idx];
            idx = path.IndexOf("?ref=", StringComparison.Ordinal);
            if (idx >= 0) return path[..idx];
            return path;
        }
    }
}
