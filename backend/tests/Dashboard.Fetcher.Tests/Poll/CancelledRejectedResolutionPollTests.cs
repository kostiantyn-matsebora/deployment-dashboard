using System.Net;
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
/// Tests for cancelled and rejected status resolution (Part B of issue #268).
/// A GitHub deployment_status of "failure" may represent:
///   - A genuine failure (job ran and failed).
///   - A cancellation (run was cancelled; run.conclusion == "cancelled").
///   - A reviewer rejection (environment gate was denied; deployment review state == "rejected").
/// </summary>
public sealed class CancelledRejectedResolutionPollTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 500L;
    private const long DeployId = 99L;

    // ── cancelled ────────────────────────────────────────────────────────────

    /// <summary>
    /// When a deployment has failure state AND the associated run conclusion is "cancelled",
    /// the emitted contract status must be "cancelled", not "failure".
    /// </summary>
    [Fact]
    public async Task FailureWithCancelledRunConclusion_EmitsCancelledStatus()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        var status = MakeStatus(DeployId, "failure", RunId, since.AddMinutes(10));

        var urlMap = BuildUrlMap(
            deployment, status,
            runConclusion: "cancelled",
            reviewStates: []);  // no reviews

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(DeploymentStatus.Cancelled, ev.Status);
    }

    /// <summary>
    /// When the run conclusion is "timed_out" (not "cancelled"), the status stays "failure".
    /// Only exact "cancelled" conclusion maps to the cancelled contract status.
    /// </summary>
    [Fact]
    public async Task FailureWithTimedOutRunConclusion_EmitsFailureStatus()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        var status = MakeStatus(DeployId, "failure", RunId, since.AddMinutes(10));

        var urlMap = BuildUrlMap(
            deployment, status,
            runConclusion: "timed_out",
            reviewStates: []);

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(DeploymentStatus.Failure, ev.Status);
    }

    /// <summary>
    /// When there is no run ID (no target_url), the status falls back to "failure"
    /// (cannot determine run conclusion without a run_id).
    /// </summary>
    [Fact]
    public async Task FailureWithNoRunId_EmitsFailureStatus()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        // Status has no target_url — run_id cannot be extracted.
        var status = new GhDeploymentStatus
        {
            Id = DeployId * 10,
            State = "failure",
            TargetUrl = null,
            CreatedAt = since.AddMinutes(10),
        };

        // No reviews, no run metadata.
        var urlMap = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] = new List<GhDeployment> { deployment },
            [$"/repos/{Owner}/{Repo}/deployments/{DeployId}/statuses"] =
                new List<GhDeploymentStatus> { status },
            [$"/repos/{Owner}/{Repo}/deployments/{DeployId}/reviews"] =
                new List<GhDeploymentReview>(),
        };

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(DeploymentStatus.Failure, ev.Status);
    }

    // ── rejected ─────────────────────────────────────────────────────────────

    /// <summary>
    /// When a deployment has failure state AND a deployment review with state "rejected" exists,
    /// the emitted contract status must be "rejected".
    /// Rejected takes precedence over cancelled (reviews are checked first).
    /// </summary>
    [Fact]
    public async Task FailureWithRejectedReview_EmitsRejectedStatus()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        var status = MakeStatus(DeployId, "failure", RunId, since.AddMinutes(10));

        var urlMap = BuildUrlMap(
            deployment, status,
            runConclusion: "cancelled",        // even though run is cancelled …
            reviewStates: ["rejected"]);        // … rejected takes precedence

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(DeploymentStatus.Rejected, ev.Status);
    }

    /// <summary>
    /// When all reviews are "approved" (no rejection), the status is not "rejected".
    /// An approved review with a failure state means the run itself failed post-approval.
    /// </summary>
    [Fact]
    public async Task FailureWithApprovedReviews_EmitsFailureStatus()
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        var status = MakeStatus(DeployId, "failure", RunId, since.AddMinutes(10));

        var urlMap = BuildUrlMap(
            deployment, status,
            runConclusion: "failure",
            reviewStates: ["approved"]);

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(DeploymentStatus.Failure, ev.Status);
    }

    // ── non-failure statuses pass through unmodified ─────────────────────────

    /// <summary>
    /// "success", "in_progress", "pending", "queued", "waiting" raw states
    /// are NOT subjected to the cancellation/rejection resolution path.
    /// </summary>
    [Theory]
    [InlineData("success", DeploymentStatus.Success)]
    [InlineData("in_progress", DeploymentStatus.InProgress)]
    [InlineData("pending", DeploymentStatus.Pending)]
    [InlineData("queued", DeploymentStatus.Queued)]
    [InlineData("waiting", DeploymentStatus.Waiting)]
    public async Task NonFailureState_EmitsExpectedStatusWithoutReviewCall(
        string rawState, string expectedStatus)
    {
        var since = DateTimeOffset.UtcNow.AddHours(-2);
        var deployment = MakeDeployment(DeployId, "prod");
        var status = MakeStatus(DeployId, rawState, RunId, since.AddMinutes(10));

        // Deliberately omit reviews endpoint; a call would result in 404 → not called for non-failure.
        var urlMap = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] = new List<GhDeployment> { deployment },
            [$"/repos/{Owner}/{Repo}/deployments/{DeployId}/statuses"] =
                new List<GhDeploymentStatus> { status },
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] =
                new GhWorkflowRun { Id = RunId, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc", Conclusion = "success" },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] =
                new GhWorkflowFileContent { Content = WorkflowYamlBase64, Encoding = "base64" },
        };

        var adapter = BuildAdapter(new FakeGithubHandler(urlMap));
        var cursor = new GithubCursor().WithRepo(FullRepo, since).Encode();
        var events = await DrainPollAsync(adapter, cursor);

        var ev = Assert.Single(events, e => e.DeploymentId == $"gh-deploy-{DeployId}");
        Assert.Equal(expectedStatus, ev.Status);
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static GhDeployment MakeDeployment(long id, string env) =>
        new()
        {
            Id = id,
            Sha = $"sha{id:D4}",
            Ref = "main",
            Environment = env,
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
        };

    private static GhDeploymentStatus MakeStatus(long deployId, string state, long runId, DateTimeOffset createdAt) =>
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

    private static readonly string WorkflowYamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes("""
        name: Deploy API
        jobs:
          deploy-prod:
            environment: prod
            runs-on: ubuntu-latest
            steps: []
        """));

    /// <summary>
    /// Builds a URL map with run metadata (including conclusion) and optional review records.
    /// </summary>
    private static Dictionary<string, object> BuildUrlMap(
        GhDeployment deployment,
        GhDeploymentStatus status,
        string? runConclusion,
        IReadOnlyList<string> reviewStates)
    {
        var reviews = reviewStates.Select(s => new GhDeploymentReview { State = s }).ToList();

        return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/deployments"] = new List<GhDeployment> { deployment },
            [$"/repos/{Owner}/{Repo}/deployments/{deployment.Id}/statuses"] =
                new List<GhDeploymentStatus> { status },
            [$"/repos/{Owner}/{Repo}/deployments/{deployment.Id}/reviews"] = reviews,
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] =
                new GhWorkflowRun
                {
                    Id = RunId,
                    Name = "Deploy API",
                    Path = ".github/workflows/deploy.yml",
                    HeadSha = "abc0001",
                    Conclusion = runConclusion,
                },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] =
                new GhWorkflowFileContent { Content = WorkflowYamlBase64, Encoding = "base64" },
        };
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

    // ── fake HTTP handler ─────────────────────────────────────────────────────

    private sealed class FakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";
            var lookup = StripQuerySuffix(path);
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

        private static string StripQuerySuffix(string path)
        {
            foreach (var marker in new[] { "&per_page=", "?per_page=", "?ref=" })
            {
                var idx = path.IndexOf(marker, StringComparison.Ordinal);
                if (idx >= 0) return path[..idx];
            }
            return path;
        }
    }
}
