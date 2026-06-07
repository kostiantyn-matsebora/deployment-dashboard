using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Poll;

/// <summary>
/// Proves that terminal-skip is order-independent: the latest status is selected by
/// maximum created_at, not by array position.  The root cause (statuses[0] positional
/// assumption) was confirmed empirically — these tests reproduce it and guard the fix.
/// </summary>
public sealed class StatusOrderingPollTests
{
    private const string Owner = "acme";
    private const string Repo = "svc";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 500L;

    // ── 1. Repro: terminal status at MAX created_at, but at non-zero array index ──

    /// <summary>
    /// Statuses served with oldest-first array order: index 0 = waiting (non-terminal),
    /// last index = success (terminal, highest created_at).
    /// Cycle 1 must populate the terminal cache; cycle 2 must issue zero /statuses calls.
    /// This test would fail against the old statuses[0] code and pass after the MaxBy fix.
    /// </summary>
    [Fact]
    public async Task Terminal_AtMaxCreatedAt_OldestFirstOrder_SkippedOnCycle2()
    {
        var anchor = DateTimeOffset.UtcNow.AddHours(-3);
        var since1 = anchor;
        var since2 = anchor.AddHours(2); // cursor advances; deployment still in window

        var deployment = MakeDeployment(id: 1, env: "prod", createdAt: anchor.AddMinutes(-5));

        // Served oldest-first: waiting → queued → in_progress → success.
        // success has the highest created_at and is the true latest.
        var statuses = new List<GhDeploymentStatus>
        {
            MakeStatus(id: 10, deployId: 1, state: "waiting",     runId: RunId, createdAt: anchor.AddMinutes(1)),
            MakeStatus(id: 11, deployId: 1, state: "queued",      runId: RunId, createdAt: anchor.AddMinutes(2)),
            MakeStatus(id: 12, deployId: 1, state: "in_progress", runId: RunId, createdAt: anchor.AddMinutes(3)),
            MakeStatus(id: 13, deployId: 1, state: "success",     runId: RunId, createdAt: anchor.AddMinutes(4)),
        };

        var urlMap = BuildUrlMap([deployment], new Dictionary<long, List<GhDeploymentStatus>> { [1] = statuses }, RunId);
        var countingHandler = new CountingFakeHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        // Cycle 1: status[0] = waiting (non-terminal) — old code would NOT cache; fix does.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 1);

        // Cycle 2: fix must skip /statuses (terminal cache hit).
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 1);

        Assert.True(callsAfterCycle1 >= 1,
            $"Cycle 1 must fetch statuses; got {callsAfterCycle1}");
        Assert.True(callsAfterCycle1 == callsAfterCycle2,
            $"Cycle 2 must issue zero /statuses calls (terminal-skip engaged). Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    /// <summary>
    /// Same scenario with the terminal state being "inactive" (the ruff-specific case)
    /// served oldest-first.  Guards inactive as a terminal state under MaxBy.
    /// </summary>
    [Fact]
    public async Task Terminal_Inactive_AtMaxCreatedAt_OldestFirstOrder_SkippedOnCycle2()
    {
        var anchor = DateTimeOffset.UtcNow.AddHours(-3);
        var since1 = anchor;
        var since2 = anchor.AddHours(2);

        var deployment = MakeDeployment(id: 2, env: "prod", createdAt: anchor.AddMinutes(-5));

        var statuses = new List<GhDeploymentStatus>
        {
            MakeStatus(id: 20, deployId: 2, state: "waiting",  runId: RunId, createdAt: anchor.AddMinutes(1)),
            MakeStatus(id: 21, deployId: 2, state: "inactive", runId: RunId, createdAt: anchor.AddMinutes(5)),
        };

        var urlMap = BuildUrlMap([deployment], new Dictionary<long, List<GhDeploymentStatus>> { [2] = statuses }, RunId);
        var countingHandler = new CountingFakeHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 2);

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 2);

        Assert.True(callsAfterCycle1 >= 1);
        Assert.True(callsAfterCycle1 == callsAfterCycle2,
            $"Cycle 2 must skip /statuses (inactive is terminal, detected via MaxBy). Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    // ── 2. Order-independence: newest-first order also skips on cycle 2 ──────────

    /// <summary>
    /// Statuses served newest-first (success at index 0): behaviour must be identical —
    /// cycle 2 skips /statuses.  Proves the fix is order-independent, not just a reversal.
    /// </summary>
    [Fact]
    public async Task Terminal_AtMaxCreatedAt_NewestFirstOrder_SkippedOnCycle2()
    {
        var anchor = DateTimeOffset.UtcNow.AddHours(-3);
        var since1 = anchor;
        var since2 = anchor.AddHours(2);

        var deployment = MakeDeployment(id: 3, env: "prod", createdAt: anchor.AddMinutes(-5));

        // Served newest-first: success (index 0) → in_progress → queued → waiting.
        var statuses = new List<GhDeploymentStatus>
        {
            MakeStatus(id: 33, deployId: 3, state: "success",     runId: RunId, createdAt: anchor.AddMinutes(4)),
            MakeStatus(id: 32, deployId: 3, state: "in_progress", runId: RunId, createdAt: anchor.AddMinutes(3)),
            MakeStatus(id: 31, deployId: 3, state: "queued",      runId: RunId, createdAt: anchor.AddMinutes(2)),
            MakeStatus(id: 30, deployId: 3, state: "waiting",     runId: RunId, createdAt: anchor.AddMinutes(1)),
        };

        var urlMap = BuildUrlMap([deployment], new Dictionary<long, List<GhDeploymentStatus>> { [3] = statuses }, RunId);
        var countingHandler = new CountingFakeHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 3);

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 3);

        Assert.True(callsAfterCycle1 >= 1);
        Assert.True(callsAfterCycle1 == callsAfterCycle2,
            $"Newest-first order must also trigger terminal-skip on cycle 2. Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    // ── 3. Regression: genuinely non-terminal max-created_at status → re-fetched ─

    /// <summary>
    /// The status with the highest created_at is "in_progress" (non-terminal).
    /// The deployment must NOT enter the terminal cache and must be re-fetched on cycle 2.
    /// </summary>
    [Fact]
    public async Task NonTerminal_AtMaxCreatedAt_RefetchedOnCycle2()
    {
        var anchor = DateTimeOffset.UtcNow.AddHours(-3);
        var since1 = anchor;
        var since2 = anchor.AddHours(2);

        var deployment = MakeDeployment(id: 4, env: "prod", createdAt: anchor.AddMinutes(-5));

        // success is NOT the latest; in_progress has the higher created_at.
        var statuses = new List<GhDeploymentStatus>
        {
            MakeStatus(id: 40, deployId: 4, state: "success",     runId: RunId, createdAt: anchor.AddMinutes(1)),
            MakeStatus(id: 41, deployId: 4, state: "in_progress", runId: RunId, createdAt: anchor.AddMinutes(3)),
        };

        var urlMap = BuildUrlMap([deployment], new Dictionary<long, List<GhDeploymentStatus>> { [4] = statuses }, RunId);
        var countingHandler = new CountingFakeHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 4);

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 4);

        Assert.True(callsAfterCycle1 >= 1,
            $"Cycle 1 must fetch statuses; got {callsAfterCycle1}");
        Assert.True(callsAfterCycle2 > callsAfterCycle1,
            $"Non-terminal deployment must be re-fetched on cycle 2. " +
            $"Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    // ── 4. Single-status terminal deployment → skipped on cycle 2 ───────────────

    /// <summary>
    /// A deployment with exactly one status that is terminal must enter the terminal
    /// cache immediately and be skipped on cycle 2.
    /// </summary>
    [Fact]
    public async Task SingleTerminalStatus_SkippedOnCycle2()
    {
        var anchor = DateTimeOffset.UtcNow.AddHours(-3);
        var since1 = anchor;
        var since2 = anchor.AddHours(2);

        var deployment = MakeDeployment(id: 5, env: "prod", createdAt: anchor.AddMinutes(-5));
        var statuses = new List<GhDeploymentStatus>
        {
            MakeStatus(id: 50, deployId: 5, state: "failure", runId: RunId, createdAt: anchor.AddMinutes(2)),
        };

        var urlMap = BuildUrlMap([deployment], new Dictionary<long, List<GhDeploymentStatus>> { [5] = statuses }, RunId);
        var countingHandler = new CountingFakeHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 5);

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 5);

        Assert.True(callsAfterCycle1 >= 1);
        Assert.True(callsAfterCycle1 == callsAfterCycle2,
            $"Single-status terminal deployment must be skipped on cycle 2. Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    // ── infrastructure ────────────────────────────────────────────────────────────

    private static GhDeployment MakeDeployment(long id, string env, DateTimeOffset createdAt) =>
        new()
        {
            Id = id,
            Sha = $"sha{id:D4}",
            Ref = "main",
            Environment = env,
            CreatedAt = createdAt,
        };

    private static GhDeploymentStatus MakeStatus(
        long id, long deployId, string state, long runId, DateTimeOffset createdAt) =>
        new()
        {
            Id = id,
            State = state,
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{runId}/jobs/{deployId}",
            CreatedAt = createdAt,
        };

    private static async Task<IReadOnlyList<DeploymentEventIngest>> DrainPollAsync(
        GithubActionsAdapter adapter, string cursor)
    {
        var events = new List<DeploymentEventIngest>();
        await foreach (var chunk in adapter.FetchAsync(cursor, CancellationToken.None))
            events.AddRange(chunk.Events);
        return events;
    }

    private static readonly string WorkflowYaml = """
        name: Deploy SVC
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
            [$"/repos/{Owner}/{Repo}/deployments"] = deploymentsForWindow,
            [$"/repos/{Owner}/{Repo}/actions/runs/{runId}"] =
                new GhWorkflowRun { Id = runId, Name = "Deploy SVC", Path = ".github/workflows/deploy.yml", HeadSha = "abc0001" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };
        foreach (var (id, statuses) in statusesById)
            map[$"/repos/{Owner}/{Repo}/deployments/{id}/statuses"] = statuses;
        return map;
    }

    private static GithubActionsAdapter BuildAdapter(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };

        var rateLimitBudget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();

        var githubClient = new GithubClient(httpClient, rateLimitBudget);
        var graphCache = new WorkflowGraphCache();

        var adapterOptions = new GithubAdapterOptions
        {
            Repos = FullRepo,
            VersionSource = "attribute:sha",
        };
        var fetcherOptions = new FetcherOptions
        {
            InitialLookback = TimeSpan.FromDays(7),
            Backfill = false,
        };
        var versionResolver = new VersionResolver(
            VersionSourceConfig.Default, graphCache, githubClient);

        var statusResolver = new GithubStatusResolver(githubClient, graphCache, NullLogger<GithubStatusResolver>.Instance);
        var backfillRunner = new BackfillRunner(
            githubClient, adapterOptions, fetcherOptions, graphCache,
            versionResolver, statusResolver, NullLogger<BackfillRunner>.Instance);

        return new GithubActionsAdapter(
            githubClient, adapterOptions, fetcherOptions, graphCache,
            versionResolver, backfillRunner, statusResolver, NullLogger<GithubActionsAdapter>.Instance);
    }

    private sealed class CountingFakeHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        private readonly List<string> _calls = [];

        public int StatusCalls(long deploymentId)
        {
            var suffix = $"/repos/{Owner}/{Repo}/deployments/{deploymentId}/statuses";
            lock (_calls)
                return _calls.Count(c => StripQuery(c).Equals(suffix, StringComparison.OrdinalIgnoreCase));
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";
            lock (_calls) _calls.Add(path);

            var lookup = StripQuery(path);
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

        private static string StripQuery(string path)
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
