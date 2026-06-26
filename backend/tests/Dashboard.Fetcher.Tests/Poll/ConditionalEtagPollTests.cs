using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Poll;

/// <summary>
/// Tests for the ETag / If-None-Match conditional request optimisation (F8 / §5.4 / §5.5.1).
/// All scenarios drive a <see cref="GithubActionsAdapter"/> instance across two poll cycles so
/// the instance-level ETag caches persist between cycles.
/// </summary>
public sealed class ConditionalEtagPollTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 500L;

    // ── 1. Statuses 304 reuse ────────────────────────────────────────────────

    /// <summary>
    /// Cycle 1: in-flight deployment → 200 with ETag → event emitted, ETag cached.
    /// Cycle 2: server receives If-None-Match matching cached ETag → returns 304.
    /// Assert: (a) cycle-2 request carried If-None-Match, (b) no event emitted, (c) no throw.
    /// </summary>
    [Fact]
    public async Task Statuses304_InFlight_NoEventEmittedOnCycle2()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 1, state: "in_progress", runId: RunId,
            createdAt: since1.AddMinutes(5));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [1] = [inProgressStatus] },
            runId: RunId);

        var handler = new ETagAwareHandler(urlMap);
        var adapter = BuildAdapter(handler);

        // Cycle 1 → 200, event emitted, ETag cached.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        var events1 = await DrainPollAsync(adapter, cursor1);

        Assert.Contains(events1, e => e.DeploymentId == "gh-deploy-1");
        Assert.True(handler.Served304Count == 0, "Cycle 1 should not have served any 304s");

        // Cycle 2 → handler should receive If-None-Match and return 304.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // (a) If-None-Match was sent for the statuses URL.
        var statusPath = $"/repos/{Owner}/{Repo}/deployments/1/statuses";
        Assert.True(handler.ReceivedIfNoneMatchFor(statusPath),
            "Cycle 2 should have sent If-None-Match for statuses");

        // (b) No event emitted for the deployment (304 = no change).
        Assert.DoesNotContain(events2, e => e.DeploymentId == "gh-deploy-1");

        // (c) No exception — implicit (test would have thrown).
    }

    // ── 2. Statuses 200 after change ─────────────────────────────────────────

    /// <summary>
    /// Cycle 2: the status list changes (new status added) → handler returns 200 (etag changed)
    /// → new event emitted; updated ETag stored.
    /// </summary>
    [Fact]
    public async Task Statuses200AfterChange_NewEventEmitted_NewEtagCached()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 2, env: "staging", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 2, state: "in_progress", runId: RunId,
            createdAt: since1.AddMinutes(5));
        var successStatus = MakeStatus(deployId: 2, state: "success", runId: RunId,
            createdAt: since2.AddMinutes(3));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [2] = [inProgressStatus] },
            runId: RunId);

        var handler = new ETagAwareHandler(urlMap);
        var adapter = BuildAdapter(handler);

        // Cycle 1.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        // Update the statuses URL to return a new (changed) list before cycle 2.
        var statusPath = $"/repos/{Owner}/{Repo}/deployments/2/statuses";
        handler.UpdatePayload(statusPath, new List<GhDeploymentStatus> { successStatus, inProgressStatus });

        // Cycle 2: status list changed → 200 expected.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // New event emitted for the new success status.
        Assert.Contains(events2, e => e.DeploymentId == "gh-deploy-2");

        // The statuses endpoint must NOT have returned 304 (payload changed → ETag rotated).
        // Note: the deployments-list endpoint may still return 304 in cycle 2 (list unchanged);
        // that is correct behaviour and does not affect this assertion.
        Assert.False(handler.Served304ForPath($"/repos/{Owner}/{Repo}/deployments/2/statuses"),
            "Statuses endpoint must return 200 when payload changed (not 304)");
    }

    // ── 3. Deployments-list 304 ──────────────────────────────────────────────

    /// <summary>
    /// Cycle 2: deployments list is unchanged → list request carries If-None-Match → 304.
    /// The in-flight deployment in the reused snapshot STILL gets its conditional status check
    /// (assert status endpoint was hit in cycle 2).
    /// </summary>
    [Fact]
    public async Task DeploymentsList304_InFlightDeploymentStillChecked()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 3, env: "prod", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 3, state: "in_progress", runId: RunId,
            createdAt: since1.AddMinutes(5));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [3] = [inProgressStatus] },
            runId: RunId);

        var handler = new ETagAwareHandler(urlMap);
        var adapter = BuildAdapter(handler);

        // Cycle 1 — seeds list ETag.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        var statusCallsAfterCycle1 = handler.CallCount($"/repos/{Owner}/{Repo}/deployments/3/statuses");

        // Cycle 2 — list unchanged → 304.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);

        // List request carried If-None-Match.
        var deploymentsPath = $"/repos/{Owner}/{Repo}/deployments";
        Assert.True(handler.ReceivedIfNoneMatchFor(deploymentsPath),
            "Cycle 2 should have sent If-None-Match for the deployments list");

        // Status endpoint was still called at least once in cycle 2 (list 304 does not skip status checks).
        var statusCallsAfterCycle2 = handler.CallCount($"/repos/{Owner}/{Repo}/deployments/3/statuses");
        Assert.True(statusCallsAfterCycle2 > statusCallsAfterCycle1,
            $"Expected status endpoint hit in cycle 2. Cycle1={statusCallsAfterCycle1}, Cycle2={statusCallsAfterCycle2}");
    }

    // ── 4. Parent edge across cycles via 304 reuse ───────────────────────────

    /// <summary>
    /// Staging goes in-flight in cycle 1, its run_id is cached. In cycle 2 staging statuses
    /// return 304 (no change). Prod gets a new success status in cycle 2 and its event must
    /// still resolve parent_deployments = ["gh-deploy-{stagingId}"] using the cached run_id.
    /// </summary>
    [Fact]
    public async Task ParentEdge_Preserved_WhenStagingStatuses304InCycle2()
    {
        const long StagingDeployId = 60;
        const long ProdDeployId = 61;
        const long SharedRunId = 400L;

        var since1 = DateTimeOffset.UtcNow.AddHours(-3);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-45);

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

        var stagingInProgress = new GhDeploymentStatus
        {
            Id = 600,
            State = "in_progress",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/1",
            CreatedAt = since1.AddMinutes(5),
        };
        var prodInProgress = new GhDeploymentStatus
        {
            Id = 610,
            State = "in_progress",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/2",
            CreatedAt = since1.AddMinutes(6),
        };
        var prodSuccess = new GhDeploymentStatus
        {
            Id = 611,
            State = "success",
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{SharedRunId}/jobs/2",
            CreatedAt = since2.AddMinutes(5),
        };

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

        var urlMap = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] =
                new List<GhDeployment> { prodDeploy, stagingDeploy },
            [$"/repos/{Owner}/{Repo}/deployments/{StagingDeployId}/statuses"] =
                new List<GhDeploymentStatus> { stagingInProgress },
            [$"/repos/{Owner}/{Repo}/deployments/{ProdDeployId}/statuses"] =
                new List<GhDeploymentStatus> { prodInProgress },
            [$"/repos/{Owner}/{Repo}/actions/runs/{SharedRunId}"] =
                new GhWorkflowRun { Id = SharedRunId, Name = "Deploy Chain", Path = ".github/workflows/chain.yml", HeadSha = "sha001" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/chain.yml"] =
                new GhWorkflowFileContent { Content = yamlBase64, Encoding = "base64" },
        };

        var handler = new ETagAwareHandler(urlMap);
        var adapter = BuildAdapter(handler);

        // Cycle 1 — seeds ETag for staging statuses.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        // Before cycle 2: update prod statuses to include success (new event needed).
        // Staging statuses remain unchanged → will return 304 with same ETag.
        var prodStatusPath = $"/repos/{Owner}/{Repo}/deployments/{ProdDeployId}/statuses";
        handler.UpdatePayload(prodStatusPath,
            new List<GhDeploymentStatus> { prodSuccess, prodInProgress });

        // Cycle 2.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        var events2 = await DrainPollAsync(adapter, cursor2);

        // Prod event must be present.
        var prodEvent = events2.SingleOrDefault(e => e.DeploymentId == $"gh-deploy-{ProdDeployId}");
        Assert.NotNull(prodEvent);

        // Parent edge must resolve via the cached staging run_id.
        Assert.NotNull(prodEvent!.ParentDeployments);
        Assert.Contains($"gh-deploy-{StagingDeployId}", prodEvent.ParentDeployments);

        // Staging statuses returned 304 in cycle 2.
        var stagingStatusPath = $"/repos/{Owner}/{Repo}/deployments/{StagingDeployId}/statuses";
        Assert.True(handler.ReceivedIfNoneMatchFor(stagingStatusPath),
            "Cycle 2 should have sent If-None-Match for staging statuses");
    }

    // ── 5. Graceful no-ETag degradation ─────────────────────────────────────

    /// <summary>
    /// Server returns 200 without an ETag header. No ETag is cached.
    /// Next cycle sends no If-None-Match (full unconditional fetch) — behaviour identical to today.
    /// </summary>
    [Fact]
    public async Task NoEtagFromServer_NoIfNoneMatchSentOnNextCycle()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 4, env: "prod", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 4, state: "in_progress", runId: RunId,
            createdAt: since1.AddMinutes(5));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [4] = [inProgressStatus] },
            runId: RunId);

        // Handler with ETags suppressed.
        var handler = new ETagAwareHandler(urlMap, suppressEtags: true);
        var adapter = BuildAdapter(handler);

        // Cycle 1 — no ETag returned.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        // Cycle 2 — must NOT send If-None-Match (nothing was cached).
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);

        var statusPath = $"/repos/{Owner}/{Repo}/deployments/4/statuses";
        Assert.False(handler.ReceivedIfNoneMatchFor(statusPath),
            "No If-None-Match should be sent when server never supplied an ETag");

        // No 304s served (handler never issues them when ETags suppressed).
        Assert.Equal(0, handler.Served304Count);
    }

    // ── 6. Rate-limit budget does NOT count 304 responses ───────────────────

    /// <summary>
    /// A 304 response passes through <c>RecordAndWaitIfNeededAsync</c> (no crash) but must
    /// NOT increment <c>Used</c>. GitHub does not charge 304 against the quota
    /// (X-RateLimit-Remaining is unchanged), so counting them would over-report usage
    /// and over-throttle — see §5.5.2 / F16.
    ///
    /// Cycle 1 seeds the ETag cache with a 200. Cycle 2 for the in-flight deployment
    /// statuses returns 304. Assert that <c>Used</c> does NOT increase for the 304 call.
    /// </summary>
    [Fact]
    public async Task RateLimitBudget_DoesNotCount304Responses()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-2);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);

        var deployment = MakeDeployment(id: 5, env: "prod", daysAgo: 1);
        var inProgressStatus = MakeStatus(deployId: 5, state: "in_progress", runId: RunId,
            createdAt: since1.AddMinutes(5));

        var urlMap = BuildUrlMap(
            deploymentsForWindow: [deployment],
            statusesById: new Dictionary<long, List<GhDeploymentStatus>> { [5] = [inProgressStatus] },
            runId: RunId);

        // Use the recording handler to track what happened.
        var handler = new ETagAwareHandler(urlMap);

        // Build adapter with a real RateLimitBudget so RecordAndWaitIfNeededAsync is exercised.
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var rateLimitBudget = await RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, CancellationToken.None);

        var githubClient = new GithubClient(httpClient, rateLimitBudget);
        var adapter = BuildAdapterFromClient(githubClient);

        // Cycle 1 — all 200 responses; seeds the ETag cache.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        await DrainPollAsync(adapter, cursor1);

        var usedAfterCycle1 = rateLimitBudget.Used;
        Assert.True(usedAfterCycle1 > 0, "Budget must have recorded cycle-1 requests");

        // Cycle 2 — statuses endpoint returns 304 (ETag cached, list unchanged).
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2); // must not throw

        // A 304 was served in cycle 2.
        Assert.True(handler.Served304Count > 0, "At least one 304 must have been served in cycle 2");

        // Own count must NOT have increased for the 304 calls — 304 is free, zero quota consumed.
        Assert.Equal(usedAfterCycle1, rateLimitBudget.Used);
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

    private static async Task<IReadOnlyList<DeploymentEventIngest>> DrainPollAsync(
        GithubActionsAdapter adapter, string cursor)
    {
        var events = new List<DeploymentEventIngest>();
        await foreach (var chunk in adapter.FetchAsync(cursor, CancellationToken.None))
            events.AddRange(chunk.Events);
        return events;
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

    private static GithubActionsAdapter BuildAdapter(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var rateLimitBudget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();
        return BuildAdapterFromClient(new GithubClient(httpClient, rateLimitBudget));
    }

    private static GithubActionsAdapter BuildAdapterFromClient(GithubClient githubClient)
    {
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
        var versionResolver = new VersionResolver(VersionSourceConfig.Default, graphCache, githubClient);
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
            backfillRunner, statusEventMapper);
    }

    // ── ETag-aware fake HTTP handler ──────────────────────────────────────────

    /// <summary>
    /// Fake handler that issues and validates ETags.
    ///
    /// Per URL, it maintains:
    ///   - The current payload version (mutable via <see cref="UpdatePayload"/>).
    ///   - The ETag for that payload version (derived from version counter).
    ///   - A count of 304 responses served.
    ///   - Whether an <c>If-None-Match</c> header was ever received for each URL.
    ///
    /// When <paramref name="suppressEtags"/> is true the handler never sets an ETag header
    /// on 200 responses, simulating a server that does not support conditional requests.
    /// </summary>
    private sealed class ETagAwareHandler(
        IDictionary<string, object> urlMap,
        bool suppressEtags = false) : HttpMessageHandler
    {
        // path → current ETag string (weak format "W/\"v{version}\"").
        private readonly Dictionary<string, string> _etags = new(StringComparer.OrdinalIgnoreCase);
        // path → version counter (bumped on UpdatePayload).
        private readonly Dictionary<string, int> _versions = new(StringComparer.OrdinalIgnoreCase);
        // Paths for which an If-None-Match header was ever received.
        private readonly HashSet<string> _ifNoneMatchReceived = new(StringComparer.OrdinalIgnoreCase);
        // Paths for which a 304 was served at least once.
        private readonly HashSet<string> _served304Paths = new(StringComparer.OrdinalIgnoreCase);
        private int _served304;
        private readonly Lock _lock = new();

        public int Served304Count { get { lock (_lock) return _served304; } }

        /// <summary>Returns true when a 304 was served for <paramref name="path"/> at least once.</summary>
        public bool Served304ForPath(string path)
        {
            lock (_lock) return _served304Paths.Contains(path);
        }

        /// <summary>Returns true when an If-None-Match header was received for <paramref name="path"/>.</summary>
        public bool ReceivedIfNoneMatchFor(string path)
        {
            lock (_lock) return _ifNoneMatchReceived.Contains(path);
        }

        /// <summary>Returns the total number of times <paramref name="path"/> was requested.</summary>
        public int CallCount(string path)
        {
            lock (_lock)
                return _callCounts.TryGetValue(path, out var c) ? c : 0;
        }

        private readonly Dictionary<string, int> _callCounts = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Replaces the payload for <paramref name="path"/> and rotates its ETag version,
        /// so the next request with the old ETag will receive 200, not 304.
        /// </summary>
        public void UpdatePayload(string path, object newPayload)
        {
            lock (_lock)
            {
                urlMap[path] = newPayload;
                _versions[path] = _versions.GetValueOrDefault(path) + 1;
                // Clear the ETag so it is regenerated on the next 200.
                _etags.Remove(path);
            }
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var pathAndQuery = request.RequestUri?.PathAndQuery ?? "";
            var path = StripSuffix(pathAndQuery);

            lock (_lock)
            {
                _callCounts[path] = _callCounts.GetValueOrDefault(path) + 1;

                // Record any If-None-Match header.
                if (request.Headers.IfNoneMatch.Count > 0)
                    _ifNoneMatchReceived.Add(path);

                if (!urlMap.TryGetValue(path, out var payload))
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));

                // Determine current ETag (lazy: created on first 200 for this path).
                if (!suppressEtags && !_etags.TryGetValue(path, out var currentEtag))
                {
                    var version = _versions.GetValueOrDefault(path, 0);
                    currentEtag = $"W/\"v{version}\"";
                    _etags[path] = currentEtag;
                }
                else if (suppressEtags)
                {
                    currentEtag = null;
                }
                else
                {
                    _etags.TryGetValue(path, out currentEtag);
                }

                // Check If-None-Match against current ETag.
                if (currentEtag is not null && request.Headers.IfNoneMatch.Count > 0)
                {
                    var receivedEtag = request.Headers.IfNoneMatch
                        .FirstOrDefault()?.ToString();

                    if (string.Equals(receivedEtag, currentEtag, StringComparison.Ordinal))
                    {
                        _served304++;
                        _served304Paths.Add(path);
                        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotModified));
                    }
                }

                // 200 response with ETag header.
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                };
                if (!suppressEtags && currentEtag is not null)
                    response.Headers.ETag = EntityTagHeaderValue.Parse(currentEtag);

                return Task.FromResult(response);
            }
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
