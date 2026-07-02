using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Cursor;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Shared.Contracts;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Poll;

/// <summary>
/// Regression tests for GitHub issue #407: long-running (approval-gated) deployments
/// whose <c>created_at</c> is older than <c>since − 1 day</c> must not be evicted from
/// the deployments-list window before their terminal status arrives.
///
/// Fix: <see cref="GithubActionsAdapter"/> stores the <c>created_at</c> of every
/// non-terminal deployment as <c>oldest_pending</c> in the cursor.  The next cycle
/// extends the list cutoff floor to <c>min(since − 1day, oldest_pending)</c>, keeping
/// the deployment in the window even when it would otherwise fall below the 1-day threshold.
///
/// Two-cycle harness pattern mirrors <see cref="StatusOrderingPollTests"/>.
/// </summary>
public sealed class OldestPendingPollTests
{
    private const string Owner = "acme";
    private const string Repo = "svc";
    private const string FullRepo = $"{Owner}/{Repo}";

    // ── 1. Cycle 1 emits waiting + cursor has oldest_pending ─────────────────

    /// <summary>
    /// A deployment whose <c>created_at = T</c> receives a "waiting" status at <c>T + 25h</c>.
    /// After cycle 1:
    /// (a) the waiting event must be emitted;
    /// (b) the returned cursor's <c>oldest_pending</c> must equal the deployment's created_at.
    /// </summary>
    [Fact]
    public async Task Cycle1_WaitingStatus_EmitsEvent_AndCursorHasOldestPending()
    {
        var t = new DateTimeOffset(2026, 1, 15, 0, 0, 0, TimeSpan.Zero);
        var deployedAt = t;
        var cycle1Since = t;
        var waitingAt = t.AddHours(25); // > cycle1Since → emitted; becomes maxSince

        var deployment = MakeDeployment(id: 1, env: "prod", createdAt: deployedAt);
        var cycle1Statuses = new[] { MakeStatus(10, "waiting", waitingAt) };
        // cycle 2 statuses (not reached in this test)
        var cycle2Statuses = new[] { MakeStatus(10, "waiting", waitingAt), MakeStatus(11, "success", waitingAt.AddHours(1)) };

        var handler = new TwoCycleStatusHandler(deployment, cycle1Statuses, cycle2Statuses);
        var adapter = BuildAdapter(handler);

        // Cycle 1
        var startCursor = new GithubCursor().WithRepo(FullRepo, cycle1Since).Encode();
        var (events1, cursor1Str) = await DrainPollWithCursorAsync(adapter, startCursor);

        // (a) waiting event emitted
        Assert.Contains(events1, e => e.Status == DeploymentStatus.Waiting);

        // (b) cursor carries oldest_pending = deployedAt
        var decoded1 = GithubCursor.Decode(cursor1Str);
        Assert.Equal(deployedAt, decoded1.OldestPendingFor(FullRepo));
    }

    // ── 2. Full two-cycle regression: success not missed after window shrinks ─

    /// <summary>
    /// Full scenario proving the #407 regression is fixed:
    ///
    /// Timeline:
    ///   T         — deployment created_at (= cycle-1 since; floor in cycle 1 = T − 1d; deployment in window)
    ///   T + 25h   — "waiting" status; cycle-1 maxSince; becomes cycle-2 since
    ///   T + 26h   — "success" status appended for cycle 2
    ///
    /// Without fix — cycle-2 cutoff = (T + 25h) − 1d = T + 1h → deployment.created_at (T) &lt; T+1h
    ///   → deployment evicted → /statuses never fetched → success event MISSED.
    ///
    /// With fix — cutoff = min(T+1h, oldest_pending = T) = T → deployment included → success emitted.
    /// </summary>
    [Fact]
    public async Task Cycle2_OldestPendingExtendsCutoff_SuccessEventEmitted()
    {
        var t = new DateTimeOffset(2026, 1, 15, 0, 0, 0, TimeSpan.Zero);
        var deployedAt = t;
        var cycle1Since = t;
        var waitingAt = t.AddHours(25);  // cycle-1 maxSince → cycle-2 since
        var successAt = waitingAt.AddHours(1);

        var deployment = MakeDeployment(id: 2, env: "prod", createdAt: deployedAt);
        var cycle1Statuses = new[] { MakeStatus(20, "waiting", waitingAt) };
        var cycle2Statuses = new[]
        {
            MakeStatus(20, "waiting", waitingAt),
            MakeStatus(21, "success", successAt),
        };

        var handler = new TwoCycleStatusHandler(deployment, cycle1Statuses, cycle2Statuses);
        var adapter = BuildAdapter(handler);

        // Cycle 1 — collect the advanced cursor
        var startCursor = new GithubCursor().WithRepo(FullRepo, cycle1Since).Encode();
        var (events1, cursor1Str) = await DrainPollWithCursorAsync(adapter, startCursor);

        Assert.Contains(events1, e => e.Status == DeploymentStatus.Waiting);

        // Cycle 2 — thread cursor from cycle 1 (oldest_pending = deployedAt = T)
        var (events2, _) = await DrainPollWithCursorAsync(adapter, cursor1Str);

        // The success event must be present — deployment was NOT evicted by the narrowed window.
        Assert.Contains(events2, e => e.Status == DeploymentStatus.Success);

        // The waiting status (created_at = T+25h = cycle-2 since) is NOT re-emitted (≤ since, skipped).
        Assert.DoesNotContain(events2, e => e.Status == DeploymentStatus.Waiting);
    }

    // ── 3. After success: next cursor clears oldest_pending ──────────────────

    /// <summary>
    /// After cycle 2 processes the "success" terminal status, all in-window deployments
    /// are terminal.  The cursor emitted by cycle 2 must have <c>oldest_pending = null</c>
    /// — clearing the floor avoids unnecessarily extending the window in future cycles.
    /// </summary>
    [Fact]
    public async Task Cycle2_SuccessTerminal_NextCursorOldestPendingIsNull()
    {
        var t = new DateTimeOffset(2026, 1, 15, 0, 0, 0, TimeSpan.Zero);
        var deployedAt = t;
        var cycle1Since = t;
        var waitingAt = t.AddHours(25);
        var successAt = waitingAt.AddHours(1);

        var deployment = MakeDeployment(id: 3, env: "prod", createdAt: deployedAt);
        var cycle1Statuses = new[] { MakeStatus(30, "waiting", waitingAt) };
        var cycle2Statuses = new[]
        {
            MakeStatus(30, "waiting", waitingAt),
            MakeStatus(31, "success", successAt),
        };

        var handler = new TwoCycleStatusHandler(deployment, cycle1Statuses, cycle2Statuses);
        var adapter = BuildAdapter(handler);

        var startCursor = new GithubCursor().WithRepo(FullRepo, cycle1Since).Encode();
        var (_, cursor1Str) = await DrainPollWithCursorAsync(adapter, startCursor);

        // Cycle 2
        var (_, cursor2Str) = await DrainPollWithCursorAsync(adapter, cursor1Str);

        var decoded2 = GithubCursor.Decode(cursor2Str);
        Assert.Null(decoded2.OldestPendingFor(FullRepo));
    }

    // ── 4. Already-terminal on cycle 1 → cursor carries no oldest_pending ────

    /// <summary>
    /// When a deployment's latest status is already terminal on cycle 1, it is not pending.
    /// The cursor must carry <c>oldest_pending = null</c> (no pending floor needed).
    /// </summary>
    [Fact]
    public async Task Cycle1_TerminalStatus_CursorHasNullOldestPending()
    {
        var t = new DateTimeOffset(2026, 1, 15, 0, 0, 0, TimeSpan.Zero);
        var deployedAt = t;
        var cycle1Since = t;
        var successAt = t.AddHours(1); // > cycle1Since → emitted

        var deployment = MakeDeployment(id: 4, env: "prod", createdAt: deployedAt);
        var terminalStatuses = new[] { MakeStatus(40, "success", successAt) };
        // handler serves same data both cycles (terminal-cached on cycle 2; not relevant here)
        var handler = new TwoCycleStatusHandler(deployment, terminalStatuses, terminalStatuses);
        var adapter = BuildAdapter(handler);

        var startCursor = new GithubCursor().WithRepo(FullRepo, cycle1Since).Encode();
        var (events1, cursor1Str) = await DrainPollWithCursorAsync(adapter, startCursor);

        Assert.Contains(events1, e => e.Status == DeploymentStatus.Success);

        var decoded1 = GithubCursor.Decode(cursor1Str);
        Assert.Null(decoded1.OldestPendingFor(FullRepo));
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static async Task<(IReadOnlyList<DeploymentEventIngest> Events, string? Cursor)>
        DrainPollWithCursorAsync(GithubActionsAdapter adapter, string? cursor)
    {
        var events = new List<DeploymentEventIngest>();
        string? lastCursor = null;
        await foreach (var chunk in adapter.FetchAsync(cursor, CancellationToken.None))
        {
            events.AddRange(chunk.Events);
            lastCursor = chunk.Cursor;
        }
        return (events, lastCursor);
    }

    private static GhDeployment MakeDeployment(long id, string env, DateTimeOffset createdAt) =>
        new()
        {
            Id = id,
            Sha = $"sha{id:D4}",
            Ref = "main",
            Environment = env,
            CreatedAt = createdAt,
        };

    /// <summary>
    /// Creates a deployment status with no <c>target_url</c> so the adapter skips workflow
    /// graph fetching entirely (ExtractRunId returns null → no HTTP call for the run).
    /// The event is still emitted; version will be null rather than blocking the assertion.
    /// </summary>
    private static GhDeploymentStatus MakeStatus(long id, string state, DateTimeOffset createdAt) =>
        new()
        {
            Id = id,
            State = state,
            // TargetUrl intentionally absent: ExtractRunId → null → no graph fetch needed.
            CreatedAt = createdAt,
        };

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

    /// <summary>
    /// Stateful fake HTTP handler that serves different /statuses responses across poll cycles.
    ///
    /// Deployments list: always returns the single deployment (no ETag so the adapter never
    /// uses the cache and always applies the <c>stopBefore</c> cutoff filter on every cycle).
    ///
    /// /statuses: returns <paramref name="cycle1Statuses"/> on the first call and
    /// <paramref name="cycle2Statuses"/> on all subsequent calls.  This simulates the
    /// "success appended" transition between cycle 1 and cycle 2.
    ///
    /// All other paths (workflow run, yaml, etc.) return 404.  Since statuses have no
    /// <c>target_url</c>, the adapter never requests those paths.
    /// </summary>
    private sealed class TwoCycleStatusHandler(
        GhDeployment deployment,
        IReadOnlyList<GhDeploymentStatus> cycle1Statuses,
        IReadOnlyList<GhDeploymentStatus> cycle2Statuses)
        : HttpMessageHandler
    {
        private int _statusCallCount;

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken ct)
        {
            var path = StripQuery(request.RequestUri!.PathAndQuery);

            // Deployments list — always serves the single deployment, no ETag.
            var deploymentsPath = $"/repos/{Owner}/{Repo}/deployments";
            if (path.Equals(deploymentsPath, StringComparison.OrdinalIgnoreCase))
                return RespondJson(new[] { deployment });

            // Statuses — cycle-1 response on first call, cycle-2 response thereafter.
            var statusesPath = $"/repos/{Owner}/{Repo}/deployments/{deployment.Id}/statuses";
            if (path.Equals(statusesPath, StringComparison.OrdinalIgnoreCase))
            {
                var call = Interlocked.Increment(ref _statusCallCount);
                return call == 1 ? RespondJson(cycle1Statuses) : RespondJson(cycle2Statuses);
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static Task<HttpResponseMessage> RespondJson<T>(T payload) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
            });

        private static string StripQuery(string path)
        {
            var idx = path.IndexOf('?');
            return idx >= 0 ? path[..idx] : path;
        }
    }
}
