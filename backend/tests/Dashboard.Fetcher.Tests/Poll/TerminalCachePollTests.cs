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
/// Tests for the live-poll terminal-skip optimisation (§5.5 poll-efficiency note).
/// All tests drive the same <see cref="GithubActionsAdapter"/> instance across two poll
/// cycles so that the terminal cache (an instance field) persists between them.
/// </summary>
public sealed class TerminalCachePollTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 200L;

    // ── 1. Terminal skip: /statuses NOT called on 2nd cycle ──────────────────

    /// <summary>
    /// A deployment whose latest status is "success" goes into the terminal cache
    /// at the end of cycle 1.  On cycle 2 its /statuses endpoint must NOT be called,
    /// and it must produce no events.
    /// </summary>
    [Fact]
    public async Task TerminalDeployment_StatusesNotRefetchedOnSecondCycle()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30); // cursor advances after cycle 1

        // Deployment created within the lookback window.
        var deployment = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        // Single terminal status — emitted in cycle 1 (createdAt > since1).
        var successStatus = MakeStatus(deployId: 1, state: "success", runId: RunId, createdAt: since1.AddMinutes(30));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [successStatus],
            },
            runId: RunId);

        var countingHandler = new CountingFakeGithubHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        // Cycle 1: encode a cursor that puts since1 as the window start.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        var statusCallsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 1);

        // Cycle 2: advance the cursor to since2 so the deployment still falls in window.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);

        var statusCallsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 1);

        // Cycle 1 must have fetched statuses (deployment not yet in cache).
        Assert.True(statusCallsAfterCycle1 >= 1,
            $"Expected ≥1 /statuses call in cycle 1 but got {statusCallsAfterCycle1}");

        // Cycle 2 must NOT have fetched statuses (deployment is now in terminal cache).
        Assert.Equal(statusCallsAfterCycle1, statusCallsAfterCycle2);
    }

    /// <summary>
    /// The terminal deployment produces no new events in cycle 2 (no events emitted
    /// for a deployment whose statuses were skipped).
    /// </summary>
    [Fact]
    public async Task TerminalDeployment_ProducesNoEventsOnSecondCycle()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 2, env: "staging", daysAgo: 1);
        var successStatus = MakeStatus(deployId: 2, state: "success", runId: RunId, createdAt: since1.AddMinutes(10));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [2] = [successStatus] },
            runId: RunId);

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        var events1 = await DrainPollAsync(adapter, cursor1);

        // cycle 2 — only the terminal deployment is in the window
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // Cycle 1 emits the success event.
        Assert.Contains(events1, e => e.DeploymentId == "gh-deploy-2");

        // Cycle 2 emits nothing for the terminal deployment.
        Assert.DoesNotContain(events2, e => e.DeploymentId == "gh-deploy-2");
    }

    // ── 2. In-flight deployment is re-fetched each cycle ─────────────────────

    /// <summary>
    /// A deployment with latest status "in_progress" is NOT terminal, so its
    /// /statuses endpoint is re-fetched on both cycle 1 and cycle 2.
    /// </summary>
    [Fact]
    public async Task InFlightDeployment_RefetchedOnEveryPollCycle()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 3, env: "prod", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 3, state: "in_progress", runId: RunId, createdAt: since1.AddMinutes(5));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [3] = [inProgressStatus] },
            runId: RunId);

        var countingHandler = new CountingFakeGithubHandler(urlMap);
        var adapter = BuildAdapter(countingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);
        var callsAfterCycle1 = countingHandler.StatusCalls(deploymentId: 3);

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);
        var callsAfterCycle2 = countingHandler.StatusCalls(deploymentId: 3);

        // At least one call in cycle 1 and at least one more in cycle 2.
        Assert.True(callsAfterCycle1 >= 1, $"Expected ≥1 call in cycle 1, got {callsAfterCycle1}");
        Assert.True(callsAfterCycle2 > callsAfterCycle1,
            $"Expected more calls after cycle 2 (in-flight must be re-read). " +
            $"Cycle1={callsAfterCycle1}, Cycle2={callsAfterCycle2}");
    }

    // ── 3. New deployment in cycle 2 is always fetched ───────────────────────

    /// <summary>
    /// A deployment id that does not appear in cycle 1 is never in the terminal cache.
    /// When it appears in cycle 2 its /statuses ARE fetched and its event is ingested.
    /// </summary>
    [Fact]
    public async Task NewDeploymentInCycle2_StatusesFetchedAndEventEmitted()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        // Cycle 1: deployment 10 (terminal, success).
        var deployOld = MakeDeployment(id: 10, env: "prod", daysAgo: 1);
        var oldStatus = MakeStatus(deployId: 10, state: "success", runId: RunId, createdAt: since1.AddMinutes(5));

        // Cycle 2: deployment 11 appears (brand-new, success after since2).
        var deployNew = MakeDeployment(id: 11, env: "prod", daysAgo: 0); // just now
        var newStatus = MakeStatus(deployId: 11, state: "success", runId: RunId + 1, createdAt: since2.AddMinutes(2));

        // Cycle 1 URL map: only deployment 10.
        var urlMapCycle1 = BuildUrlMap(
            deploymentsForWindow: [deployOld],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [10] = [oldStatus] },
            runId: RunId);

        // Cycle 2 URL map: both deployments (10 is still in window; 11 is new).
        var urlMapCycle2 = BuildUrlMap(
            deploymentsForWindow: [deployNew, deployOld],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [10] = [oldStatus],
                [11] = [newStatus],
            },
            runId: RunId);
        // Add run metadata for the new deployment's run.
        urlMapCycle2[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "newsha" };

        var switchingHandler = new SwitchableHandler(urlMapCycle1, urlMapCycle2);
        var adapter = BuildAdapter(switchingHandler);

        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        var events1 = await DrainPollAsync(adapter, cursor1);

        // After cycle 1 switch to the cycle-2 map.
        switchingHandler.UseCycle2();

        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // Cycle 2 must have emitted the new deployment's event.
        Assert.Contains(events2, e => e.DeploymentId == "gh-deploy-11");
        // And NOT a duplicate from the terminal deployment 10.
        Assert.DoesNotContain(events2, e => e.DeploymentId == "gh-deploy-10");
    }

    // ── 4. Parent edge preserved across cycles (the chain case) ─────────────

    /// <summary>
    /// Cycle 1: "staging" deployment goes terminal (success).
    /// Cycle 2: "production" deployment in the SAME run gets a new status.
    /// Production's event must resolve parent_deployments = ["gh-deploy-{stagingId}"]
    /// even though staging's /statuses were NOT re-fetched in cycle 2.
    /// The cached runId is used to keep staging in the envToDeploymentId map.
    /// </summary>
    [Fact]
    public async Task ParentEdge_PreservedAcrossCycles_WhenStagingGoesTerminalInCycle1()
    {
        const long StagingDeployId = 50;
        const long ProdDeployId = 51;
        const long SharedRunId = 300L;

        var since1 = DateTimeOffset.UtcNow.AddHours(-3);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-45);

        // Both deployments share the same workflow run.
        var stagingDeploy = new GhDeployment
        {
            Id = StagingDeployId,
            Sha = "shaSTG",
            Ref = "main",
            Environment = "staging",
            CreatedAt = since1.AddMinutes(1),
        };
        var prodDeploy = new GhDeployment
        {
            Id = ProdDeployId,
            Sha = "shaPRD",
            Ref = "main",
            Environment = "production",
            CreatedAt = since1.AddMinutes(2),
        };

        // Cycle 1: staging gets its terminal success; prod has only in_progress (not new in cycle 2).
        var stagingSuccess = new GhDeploymentStatus
        {
            Id = 500,
            State = "success",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/1",
            CreatedAt = since1.AddMinutes(10),
        };
        var prodInProgress = new GhDeploymentStatus
        {
            Id = 510,
            State = "in_progress",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/2",
            CreatedAt = since1.AddMinutes(5),
        };

        // Cycle 2: prod gets a new success status (after since2).
        var prodSuccess = new GhDeploymentStatus
        {
            Id = 511,
            State = "success",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/2",
            CreatedAt = since2.AddMinutes(5),
        };

        // YAML: staging → production chain.
        const string ChainYaml = """
            name: Deploy Chain
            jobs:
              deploy-staging:
                environment: staging
                runs-on: ubuntu-latest
                steps: []
              deploy-production:
                environment: production
                needs: deploy-staging
                runs-on: ubuntu-latest
                steps: []
            """;
        var yamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(ChainYaml));

        // ── Cycle 1 URL map ──────────────────────────────────────────────────
        var urlMapCycle1 = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] =
                new List<GhDeployment> { prodDeploy, stagingDeploy },
            [$"/repos/{Owner}/{Repo}/deployments/{StagingDeployId}/statuses"] =
                new List<GhDeploymentStatus> { stagingSuccess },
            [$"/repos/{Owner}/{Repo}/deployments/{ProdDeployId}/statuses"] =
                new List<GhDeploymentStatus> { prodInProgress },
            [$"/repos/{Owner}/{Repo}/actions/runs/{SharedRunId}"] =
                new GhWorkflowRun { Id = SharedRunId, Name = "Deploy Chain", Path = ".github/workflows/chain.yml", HeadSha = "sha001" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/chain.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };

        // ── Cycle 2 URL map ──────────────────────────────────────────────────
        // staging /statuses is intentionally NOT in the cycle-2 map — if it were called
        // the handler returns 404, which would break the test (and expose the bug).
        var urlMapCycle2 = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] =
                new List<GhDeployment> { prodDeploy, stagingDeploy },
            // staging /statuses deliberately absent — must NOT be called (it's terminal).
            [$"/repos/{Owner}/{Repo}/deployments/{ProdDeployId}/statuses"] =
                new List<GhDeploymentStatus> { prodSuccess, prodInProgress },
            [$"/repos/{Owner}/{Repo}/actions/runs/{SharedRunId}"] =
                new GhWorkflowRun { Id = SharedRunId, Name = "Deploy Chain", Path = ".github/workflows/chain.yml", HeadSha = "sha001" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/chain.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };

        var switchingHandler = new SwitchableHandler(urlMapCycle1, urlMapCycle2);
        var adapter = BuildAdapter(switchingHandler);

        // Cycle 1.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        // Switch to cycle-2 map (staging /statuses now absent = 404 if called).
        switchingHandler.UseCycle2();

        // Cycle 2 — prod gets a new success.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // The production event must be present.
        var prodEvent = events2.SingleOrDefault(e => e.DeploymentId == $"gh-deploy-{ProdDeployId}");
        Assert.NotNull(prodEvent);

        // And it must carry the staging deployment as a parent.
        Assert.NotNull(prodEvent!.ParentDeployments);
        Assert.Contains($"gh-deploy-{StagingDeployId}", prodEvent.ParentDeployments);
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static GhDeployment MakeDeployment(long id, string env, int daysAgo) =>
        new()
        {
            Id = id,
            Sha = $"sha{id:D4}",
            Ref = "main",
            Environment = env,
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-daysAgo),
        };

    private static GhDeploymentStatus MakeStatus(
        long deployId, string state, long runId, DateTimeOffset createdAt) =>
        new()
        {
            Id = deployId * 10,
            State = state,
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{runId}/jobs/1",
            CreatedAt = createdAt,
        };

    /// <summary>
    /// Drives the adapter through one normal poll cycle (not backfill).
    /// Returns all events emitted in that cycle.
    /// </summary>
    private static async Task<IReadOnlyList<DeploymentEventIngest>> DrainPollAsync(
        GithubActionsAdapter adapter, string cursor)
    {
        var events = new List<DeploymentEventIngest>();
        await foreach (var chunk in adapter.FetchAsync(cursor, CancellationToken.None))
            events.AddRange(chunk.Events);
        return events;
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
            Backfill = false, // must not trigger backfill path
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

    private const string WorkflowYaml = """
        name: Deploy API
        jobs:
          deploy-prod:
            environment: prod
            runs-on: ubuntu-latest
            steps: []
        """;

    /// <summary>
    /// Builds a URL map keyed by path (without pagination suffixes).
    /// The deployments endpoint key uses the plain /deployments path because the
    /// adapter's GetPagedAsync appends ?per_page= / &amp;page= (stripped by the handler).
    /// </summary>
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
                new GhWorkflowRun { Id = runId, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc0001" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };
        foreach (var (id, statuses) in statusesById)
            map[$"/repos/{Owner}/{Repo}/deployments/{id}/statuses"] = statuses;
        return map;
    }

    // ── fake HTTP handlers ────────────────────────────────────────────────────

    private sealed class FakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";
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

    /// <summary>Records each URL path called; delegates to FakeGithubHandler for responses.</summary>
    private sealed class CountingFakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        private readonly List<string> _calls = [];

        public int StatusCalls(long deploymentId)
        {
            var suffix = $"/repos/{Owner}/{Repo}/deployments/{deploymentId}/statuses";
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

    /// <summary>
    /// Serves cycle-1 responses by default; switches to cycle-2 map after <see cref="UseCycle2"/> is called.
    /// Used to present different deployment-window states across two poll cycles.
    /// </summary>
    private sealed class SwitchableHandler(
        IReadOnlyDictionary<string, object> cycle1Map,
        IReadOnlyDictionary<string, object> cycle2Map)
        : HttpMessageHandler
    {
        private volatile bool _useCycle2;

        public void UseCycle2() => _useCycle2 = true;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var urlMap = _useCycle2 ? cycle2Map : cycle1Map;
            var path = request.RequestUri?.PathAndQuery ?? "";
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
