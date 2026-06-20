using System.Net;
using System.Net.Http.Headers;
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
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Poll;

/// <summary>
/// Tests for the live-poll deployments-list early-stop optimisation (§5.5.2).
///
/// GitHub returns deployments newest-first.  Once an item older than the cutoff is
/// encountered, no later page can contain in-window items, so the pager should stop
/// immediately and never request further pages.  These tests assert that behaviour
/// using a fake HTTP handler that serves paginated responses via <c>Link: rel="next"</c>
/// headers and records every page URL requested.
/// </summary>
public sealed class EarlyStopPaginationTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 700L;

    // ── 1. Window covered by page 1 — page 2 never requested ─────────────────

    /// <summary>
    /// All in-window deployments fit on page 1. The server advertises page 2 via a
    /// <c>Link: rel="next"</c> header, but page 2 must never be requested because the
    /// first item on page 1 that is older than the cutoff triggers the early stop.
    /// </summary>
    [Fact]
    public async Task WindowOnPage1_Page2NeverRequested_EvenWhenServerAdvertisesNext()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-2);  // window: last 2 days
        var since = cutoff.AddDays(1);                   // cursor sits 1 day into the window

        // Page 1: two in-window deployments, then one older-than-cutoff item (stops here).
        var page1 = new List<GhDeployment>
        {
            MakeDeployment(id: 1, createdAt: since.AddHours(2)),   // in-window
            MakeDeployment(id: 2, createdAt: since.AddHours(1)),   // in-window
            MakeDeployment(id: 3, createdAt: cutoff.AddHours(-1)), // older than cutoff → stop
        };

        // Page 2: older deployments — must never be fetched.
        var page2 = new List<GhDeployment>
        {
            MakeDeployment(id: 4, createdAt: cutoff.AddDays(-1)),
            MakeDeployment(id: 5, createdAt: cutoff.AddDays(-2)),
        };

        var statusesById = new Dictionary<long, List<GhDeploymentStatus>>
        {
            [1] = [MakeStatus(deployId: 1, state: "success", runId: RunId, createdAt: since.AddHours(2))],
            [2] = [MakeStatus(deployId: 2, state: "success", runId: RunId, createdAt: since.AddHours(1))],
        };

        var handler = new PagedFakeHandler(page1, page2, statusesById, RunId);
        var adapter = BuildAdapter(handler);

        // Use a cursor that puts since as the window start so the cutoff = since - 1 day margin.
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        // In-window deployments returned events.
        Assert.Contains(events, e => e.DeploymentId == "gh-deploy-1");
        Assert.Contains(events, e => e.DeploymentId == "gh-deploy-2");

        // Out-of-window items excluded.
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-3");
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-4");
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-5");

        // Page 2 must never have been requested.
        Assert.False(handler.Page2WasRequested,
            "Page 2 must not be requested when cutoff is reached on page 1");
    }

    // ── 2. First page-1 item older than cutoff — stops immediately ────────────

    /// <summary>
    /// The very first item on page 1 is already older than the cutoff.
    /// The result must be empty, and page 2 must not be requested.
    /// </summary>
    [Fact]
    public async Task FirstPage1ItemOlderThanCutoff_EmptyResult_Page2NeverRequested()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-2);
        var since = cutoff.AddDays(1);

        var page1 = new List<GhDeployment>
        {
            MakeDeployment(id: 10, createdAt: cutoff.AddHours(-1)), // immediately older than cutoff
            MakeDeployment(id: 11, createdAt: cutoff.AddDays(-1)),
        };
        var page2 = new List<GhDeployment>
        {
            MakeDeployment(id: 12, createdAt: cutoff.AddDays(-2)),
        };

        var handler = new PagedFakeHandler(page1, page2, statusesById: [], RunId);
        var adapter = BuildAdapter(handler);

        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        Assert.Empty(events);
        Assert.False(handler.Page2WasRequested,
            "Page 2 must not be requested when first page-1 item is already past cutoff");
    }

    // ── 3. Window spills into page 2 — page 2 fetched, page 3 not ────────────

    /// <summary>
    /// Page 1 contains only in-window items (all newer than cutoff).  Page 2 contains a
    /// mix — some in-window, then one older than the cutoff.  Page 3 is advertised by
    /// page 2 but must never be fetched.
    /// </summary>
    [Fact]
    public async Task WindowSpillsOntoPage2_Page2Fetched_Page3NeverRequested()
    {
        var cutoff = DateTimeOffset.UtcNow.AddDays(-3);
        var since = cutoff.AddDays(2);

        // Page 1: all in-window (no cutoff trigger here).
        var page1 = new List<GhDeployment>
        {
            MakeDeployment(id: 20, createdAt: since.AddHours(3)),
            MakeDeployment(id: 21, createdAt: since.AddHours(2)),
        };

        // Page 2: one in-window, then cutoff crossed.
        var page2 = new List<GhDeployment>
        {
            MakeDeployment(id: 22, createdAt: since.AddHours(1)),   // in-window
            MakeDeployment(id: 23, createdAt: cutoff.AddHours(-1)), // older → stop
        };

        // Page 3: must never be fetched.
        var page3 = new List<GhDeployment>
        {
            MakeDeployment(id: 24, createdAt: cutoff.AddDays(-1)),
        };

        var statusesById = new Dictionary<long, List<GhDeploymentStatus>>
        {
            [20] = [MakeStatus(deployId: 20, state: "success", runId: RunId, createdAt: since.AddHours(3))],
            [21] = [MakeStatus(deployId: 21, state: "success", runId: RunId, createdAt: since.AddHours(2))],
            [22] = [MakeStatus(deployId: 22, state: "success", runId: RunId, createdAt: since.AddHours(1))],
        };

        var handler = new ThreePageFakeHandler(page1, page2, page3, statusesById, RunId);
        var adapter = BuildAdapter(handler);

        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        // In-window items from both page 1 and page 2 returned events.
        Assert.Contains(events, e => e.DeploymentId == "gh-deploy-20");
        Assert.Contains(events, e => e.DeploymentId == "gh-deploy-21");
        Assert.Contains(events, e => e.DeploymentId == "gh-deploy-22");

        // Out-of-window items excluded.
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-23");
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-24");

        // Page 2 was fetched (window spilled); page 3 was not.
        Assert.True(handler.Page2WasRequested, "Page 2 must be fetched when window spills");
        Assert.False(handler.Page3WasRequested,
            "Page 3 must not be requested when cutoff is reached on page 2");
    }

    // ── 4. Page-1 304 — cached snapshot reused, no pagination ────────────────

    /// <summary>
    /// Cycle 1 seeds the deployments-list ETag cache.  Cycle 2 returns 304 for the list.
    /// The cached windowed snapshot is reused; page 2 is never requested in either cycle.
    /// </summary>
    [Fact]
    public async Task List304OnCycle2_CachedSnapshotReused_NoPagination()
    {
        var since1 = DateTimeOffset.UtcNow.AddHours(-3);
        var since2 = DateTimeOffset.UtcNow.AddMinutes(-30);
        var cutoff1 = since1 - TimeSpan.FromDays(1);

        var page1 = new List<GhDeployment>
        {
            MakeDeployment(id: 30, createdAt: since1.AddHours(1)),   // in-window cycle 1 + 2
            MakeDeployment(id: 31, createdAt: cutoff1.AddHours(-1)), // older than cutoff → stop
        };
        var page2 = new List<GhDeployment>
        {
            MakeDeployment(id: 32, createdAt: cutoff1.AddDays(-1)),
        };

        var statusesById = new Dictionary<long, List<GhDeploymentStatus>>
        {
            [30] = [MakeStatus(deployId: 30, state: "in_progress", runId: RunId, createdAt: since1.AddHours(1))],
        };

        var handler = new PagedFakeHandler(page1, page2, statusesById, RunId);
        var adapter = BuildAdapter(handler);

        // Cycle 1 — seeds ETag, page 2 must not be requested.
        var cursor1 = new GithubCursor().WithRepo(FullRepo, since1).Encode();
        var events1 = await DrainPollAsync(adapter, cursor1);

        Assert.Contains(events1, e => e.DeploymentId == "gh-deploy-30");
        Assert.False(handler.Page2WasRequested,
            "Page 2 must not be requested in cycle 1");

        var page2RequestsAfterCycle1 = handler.Page2RequestCount;

        // Cycle 2 — list unchanged → 304; cached windowed snapshot reused.
        var cursor2 = new GithubCursor().WithRepo(FullRepo, since2).Encode();
        await DrainPollAsync(adapter, cursor2);

        // No additional page-2 requests in cycle 2.
        Assert.Equal(page2RequestsAfterCycle1, handler.Page2RequestCount);

        // A 304 was served for the deployments list.
        Assert.True(handler.List304Count > 0,
            "The deployments-list endpoint must have returned 304 in cycle 2");
    }

    // ── 5. Regression: in-window deployments returned newest-first ────────────

    /// <summary>
    /// Results from a single-page window are returned in newest-first order (as received
    /// from GitHub) and contain exactly the in-window items.
    /// </summary>
    [Fact]
    public async Task InWindowDeployments_ReturnedNewestFirst_ExactlyInWindow()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var cutoff = since - TimeSpan.FromDays(1);

        var inWindow1 = MakeDeployment(id: 40, createdAt: since.AddMinutes(90));
        var inWindow2 = MakeDeployment(id: 41, createdAt: since.AddMinutes(30));
        var outOfWindow = MakeDeployment(id: 42, createdAt: cutoff.AddHours(-1));

        var page1 = new List<GhDeployment> { inWindow1, inWindow2, outOfWindow };
        var page2 = new List<GhDeployment> { MakeDeployment(id: 43, createdAt: cutoff.AddDays(-1)) };

        var statusesById = new Dictionary<long, List<GhDeploymentStatus>>
        {
            [40] = [MakeStatus(deployId: 40, state: "success", runId: RunId, createdAt: since.AddMinutes(90))],
            [41] = [MakeStatus(deployId: 41, state: "success", runId: RunId, createdAt: since.AddMinutes(30))],
        };

        var handler = new PagedFakeHandler(page1, page2, statusesById, RunId);
        var adapter = BuildAdapter(handler);

        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        // Exactly the two in-window deployments produce events; no extras.
        Assert.Equal(2, events.Count(e => e.DeploymentId is "gh-deploy-40" or "gh-deploy-41"));
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-42");
        Assert.DoesNotContain(events, e => e.DeploymentId == "gh-deploy-43");
        Assert.False(handler.Page2WasRequested,
            "Page 2 must not be requested when window is fully covered by page 1");
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static GhDeployment MakeDeployment(long id, DateTimeOffset createdAt) =>
        new()
        {
            Id = id,
            Sha = $"sha{id:D4}",
            Ref = "main",
            Environment = "prod",
            CreatedAt = createdAt,
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

    // ── paged fake HTTP handlers ──────────────────────────────────────────────

    /// <summary>
    /// Serves two pages of deployments for the deployments-list endpoint.
    /// Page 1 carries a <c>Link: rel="next"</c> header pointing to page 2.
    /// Records whether page 2 was requested and counts 304 responses served for the list.
    /// Also handles: deployment statuses, workflow run, and workflow YAML.
    /// Supports ETag-based conditional requests for the deployments-list endpoint.
    /// </summary>
    private sealed class PagedFakeHandler(
        List<GhDeployment> page1,
        List<GhDeployment> page2,
        Dictionary<long, List<GhDeploymentStatus>> statusesById,
        long runId) : HttpMessageHandler
    {
        private readonly string _yamlBase64 = Convert.ToBase64String(
            Encoding.UTF8.GetBytes(WorkflowYaml));

        private readonly string _page1Etag = $"W/\"etag-p1-{Guid.NewGuid():N}\"";
        private int _page2RequestCount;
        private int _list304Count;

        public bool Page2WasRequested => _page2RequestCount > 0;
        public int Page2RequestCount => _page2RequestCount;
        public int List304Count => _list304Count;

        private static string DeploymentsBasePath => $"/repos/{Owner}/{Repo}/deployments";

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var rawPath = request.RequestUri?.PathAndQuery ?? "";
            var path = StripRef(rawPath);

            var pathBase = PagedPathBase(path);
            var pageNum = ExtractPage(path) ?? 1;

            // Deployments list (conditional, with ETag).
            if (IsSamePath(pathBase, DeploymentsBasePath))
            {
                if (pageNum == 1)
                {
                    var receivedEtag = request.Headers.IfNoneMatch.FirstOrDefault()?.ToString();
                    if (receivedEtag is not null &&
                        string.Equals(receivedEtag, _page1Etag, StringComparison.Ordinal))
                    {
                        Interlocked.Increment(ref _list304Count);
                        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotModified));
                    }

                    var resp = JsonResponse(page1);
                    resp.Headers.ETag = EntityTagHeaderValue.Parse(_page1Etag);
                    // Advertise page 2 via Link header.
                    resp.Headers.Add("Link",
                        $"<https://api.github.com{DeploymentsBasePath}?per_page=100&page=2>; rel=\"next\"");
                    return Task.FromResult(resp);
                }

                if (pageNum == 2)
                {
                    Interlocked.Increment(ref _page2RequestCount);
                    return Task.FromResult(JsonResponse(page2));
                }
            }

            // Deployment statuses.
            foreach (var (id, statuses) in statusesById)
            {
                var statusesPath = $"/repos/{Owner}/{Repo}/deployments/{id}/statuses";
                if (IsSamePath(pathBase, statusesPath))
                    return Task.FromResult(JsonResponse(statuses));
            }

            // Workflow run.
            if (IsSamePath(pathBase, $"/repos/{Owner}/{Repo}/actions/runs/{runId}"))
            {
                return Task.FromResult(JsonResponse(
                    new GhWorkflowRun
                    {
                        Id = runId,
                        Name = "Deploy API",
                        Path = ".github/workflows/deploy.yml",
                        HeadSha = "abc0001",
                    }));
            }

            // Workflow YAML.
            if (IsSamePath(pathBase, $"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"))
            {
                return Task.FromResult(JsonResponse(
                    new GhWorkflowFileContent { Content = _yamlBase64, Encoding = "base64" }));
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        // GithubClient.PagedUrl produces: {path}?per_page=100&page={N}
        // Strip the paging suffix to get the canonical base path for lookup.
        private static string PagedPathBase(string rawPath)
        {
            var idx = rawPath.IndexOf("?per_page=", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) return rawPath[..idx];
            idx = rawPath.IndexOf("&per_page=", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) return rawPath[..idx];
            return rawPath;
        }

        private static int? ExtractPage(string rawPath)
        {
            var idx = rawPath.IndexOf("&page=", StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return null;
            var rest = rawPath[(idx + 6)..];
            var end = rest.IndexOfAny(['&', '?', '#']);
            var numStr = end >= 0 ? rest[..end] : rest;
            return int.TryParse(numStr, out var n) ? n : null;
        }

        private static bool IsSamePath(string a, string b) =>
            a.Equals(b, StringComparison.OrdinalIgnoreCase);

        private static string StripRef(string path)
        {
            var idx = path.IndexOf("?ref=", StringComparison.Ordinal);
            return idx >= 0 ? path[..idx] : path;
        }

        private static HttpResponseMessage JsonResponse(object payload) =>
            new(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
    }

    /// <summary>
    /// Variant of <see cref="PagedFakeHandler"/> serving three pages of deployments.
    /// Page 1 carries a <c>Link: rel="next"</c> to page 2; page 2 carries a
    /// <c>Link: rel="next"</c> to page 3.  Records whether pages 2 and 3 were requested.
    /// </summary>
    private sealed class ThreePageFakeHandler(
        List<GhDeployment> page1,
        List<GhDeployment> page2,
        List<GhDeployment> page3,
        Dictionary<long, List<GhDeploymentStatus>> statusesById,
        long runId) : HttpMessageHandler
    {
        private readonly string _yamlBase64 = Convert.ToBase64String(
            Encoding.UTF8.GetBytes(WorkflowYaml));

        private int _page2RequestCount;
        private int _page3RequestCount;

        public bool Page2WasRequested => _page2RequestCount > 0;
        public bool Page3WasRequested => _page3RequestCount > 0;

        private static string DeploymentsBasePath => $"/repos/{Owner}/{Repo}/deployments";

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var rawPath = request.RequestUri?.PathAndQuery ?? "";
            var path = StripRef(rawPath);

            var pathBase = PagedPathBase(path);
            var pageNum = ExtractPage(path) ?? 1;

            if (IsSamePath(pathBase, DeploymentsBasePath))
            {
                if (pageNum == 1)
                {
                    var resp = JsonResponse(page1);
                    resp.Headers.Add("Link",
                        $"<https://api.github.com{DeploymentsBasePath}?per_page=100&page=2>; rel=\"next\"");
                    return Task.FromResult(resp);
                }
                if (pageNum == 2)
                {
                    Interlocked.Increment(ref _page2RequestCount);
                    var resp = JsonResponse(page2);
                    resp.Headers.Add("Link",
                        $"<https://api.github.com{DeploymentsBasePath}?per_page=100&page=3>; rel=\"next\"");
                    return Task.FromResult(resp);
                }
                if (pageNum == 3)
                {
                    Interlocked.Increment(ref _page3RequestCount);
                    return Task.FromResult(JsonResponse(page3));
                }
            }

            foreach (var (id, statuses) in statusesById)
            {
                var statusesPath = $"/repos/{Owner}/{Repo}/deployments/{id}/statuses";
                if (IsSamePath(pathBase, statusesPath))
                    return Task.FromResult(JsonResponse(statuses));
            }

            if (IsSamePath(pathBase, $"/repos/{Owner}/{Repo}/actions/runs/{runId}"))
            {
                return Task.FromResult(JsonResponse(
                    new GhWorkflowRun
                    {
                        Id = runId,
                        Name = "Deploy API",
                        Path = ".github/workflows/deploy.yml",
                        HeadSha = "abc0001",
                    }));
            }

            if (IsSamePath(pathBase, $"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"))
            {
                return Task.FromResult(JsonResponse(
                    new GhWorkflowFileContent { Content = _yamlBase64, Encoding = "base64" }));
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static string PagedPathBase(string rawPath)
        {
            var idx = rawPath.IndexOf("?per_page=", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) return rawPath[..idx];
            idx = rawPath.IndexOf("&per_page=", StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) return rawPath[..idx];
            return rawPath;
        }

        private static int? ExtractPage(string rawPath)
        {
            var idx = rawPath.IndexOf("&page=", StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return null;
            var rest = rawPath[(idx + 6)..];
            var end = rest.IndexOfAny(['&', '?', '#']);
            var numStr = end >= 0 ? rest[..end] : rest;
            return int.TryParse(numStr, out var n) ? n : null;
        }

        private static bool IsSamePath(string a, string b) =>
            a.Equals(b, StringComparison.OrdinalIgnoreCase);

        private static string StripRef(string path)
        {
            var idx = path.IndexOf("?ref=", StringComparison.Ordinal);
            return idx >= 0 ? path[..idx] : path;
        }

        private static HttpResponseMessage JsonResponse(object payload) =>
            new(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            };
    }
}
