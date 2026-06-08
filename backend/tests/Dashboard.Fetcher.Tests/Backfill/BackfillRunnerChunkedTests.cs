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

namespace Dashboard.Fetcher.Tests.Backfill;

/// <summary>
/// Tests for the chunked + resumable backfill (per-env streaming, cursor markers).
/// </summary>
public sealed class BackfillRunnerChunkedTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 100L;

    // ── 3 envs → 3 env-chunks + 1 completion marker ──────────────────────────

    [Fact]
    public async Task ThreeEnvs_YieldsThreeEnvChunksPlusOneCompletion()
    {
        var handler = new FakeGithubHandler(BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["dev", "staging", "prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["dev"] = [MakeDeployment(1, "dev", daysAgo: 1)],
                ["staging"] = [MakeDeployment(2, "staging", daysAgo: 2)],
                ["prod"] = [MakeDeployment(3, "prod", daysAgo: 3)],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(1, "success", RunId, hoursAgo: 24)],
                [2] = [MakeStatus(2, "success", RunId + 1, hoursAgo: 48)],
                [3] = [MakeStatus(3, "success", RunId + 2, hoursAgo: 72)],
            },
            workflowRunId: RunId));

        // Register extra run metadata for staging and prod deployments.
        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["dev", "staging", "prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["dev"] = [MakeDeployment(1, "dev", daysAgo: 1)],
                ["staging"] = [MakeDeployment(2, "staging", daysAgo: 2)],
                ["prod"] = [MakeDeployment(3, "prod", daysAgo: 3)],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(1, "success", RunId, hoursAgo: 24)],
                [2] = [MakeStatus(2, "success", RunId + 1, hoursAgo: 48)],
                [3] = [MakeStatus(3, "success", RunId + 2, hoursAgo: 72)],
            },
            workflowRunId: RunId);
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 2}"] =
            new GhWorkflowRun { Id = RunId + 2, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };

        var fakeHandler = new FakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(fakeHandler, depth: 1);

        var chunks = new List<FetchResult>();
        await foreach (var chunk in runner.RunAsync(new GithubCursor(), CancellationToken.None))
            chunks.Add(chunk);

        // 3 env-chunks (one per env) + 1 completion marker = 4 total.
        Assert.Equal(4, chunks.Count);

        // The last chunk is the completion marker (0 events).
        var completionChunk = chunks.Last();
        Assert.Empty(completionChunk.Events);

        // The completion marker clears the backfill marker and sets repos[repo].since.
        var finalCursor = GithubCursor.Decode(completionChunk.Cursor);
        Assert.False(finalCursor.IsBackfilling);
        Assert.True(finalCursor.Repos.ContainsKey(FullRepo));
    }

    // ── completion chunk sets since and clears the marker ────────────────────

    [Fact]
    public async Task CompletionChunk_SetsSinceAndClearsMarker()
    {
        var expectedSince = DateTimeOffset.UtcNow.AddHours(-12);

        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["prod"] = [MakeDeployment(1, "prod", daysAgo: 1)],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [new GhDeploymentStatus
                {
                    Id = 10, State = "success",
                    TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{RunId}/jobs/1",
                    CreatedAt = expectedSince,
                }],
            },
            workflowRunId: RunId);

        var (runner, _) = BuildRunner(new FakeGithubHandler(urlMap), depth: 1);

        FetchResult? lastChunk = null;
        await foreach (var chunk in runner.RunAsync(new GithubCursor(), CancellationToken.None))
            lastChunk = chunk;

        Assert.NotNull(lastChunk);
        var finalCursor = GithubCursor.Decode(lastChunk!.Cursor);

        // Completion: marker gone, since set to the max emitted status time.
        Assert.False(finalCursor.IsBackfilling);
        Assert.True(finalCursor.Repos.ContainsKey(FullRepo));
        Assert.Equal(expectedSince, finalCursor.Repos[FullRepo].Since);
    }

    // ── resume: given done_envs=[env1], only remaining envs are scanned ───────

    [Fact]
    public async Task Resume_GivenDoneEnvs_SkipsAlreadyProcessedEnvs()
    {
        // Three environments; incoming cursor has env1 already done.
        // Only env2 and env3 should be scanned; env1's GitHub endpoint must NOT be called.
        var anchor = DateTimeOffset.UtcNow;
        var incomingCursor = new GithubCursor()
            .WithBackfillEnvDone(FullRepo, anchor, "env1");

        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["env1", "env2", "env3"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["env1"] = [MakeDeployment(1, "env1", daysAgo: 1)],
                ["env2"] = [MakeDeployment(2, "env2", daysAgo: 1)],
                ["env3"] = [MakeDeployment(3, "env3", daysAgo: 1)],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(1, "success", RunId, hoursAgo: 10)],
                [2] = [MakeStatus(2, "success", RunId + 1, hoursAgo: 11)],
                [3] = [MakeStatus(3, "success", RunId + 2, hoursAgo: 12)],
            },
            workflowRunId: RunId);
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 2}"] =
            new GhWorkflowRun { Id = RunId + 2, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };

        var countingHandler = new CountingFakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(countingHandler, depth: 1);

        await foreach (var _ in runner.RunAsync(incomingCursor, CancellationToken.None))
            ; // drain

        // env1's deployment listing endpoint must NOT have been called.
        var env1Calls = countingHandler.Calls.Count(
            c => c.Contains("deployments") && c.Contains("environment=env1"));
        Assert.Equal(0, env1Calls);

        // env2 and env3 must have been scanned.
        var env2Calls = countingHandler.Calls.Count(
            c => c.Contains("deployments") && c.Contains("environment=env2"));
        var env3Calls = countingHandler.Calls.Count(
            c => c.Contains("deployments") && c.Contains("environment=env3"));
        Assert.True(env2Calls > 0, "env2 deployment listing should have been called");
        Assert.True(env3Calls > 0, "env3 deployment listing should have been called");
    }

    // ── resume: cursor from mid-backfill has correct done_envs after each chunk

    [Fact]
    public async Task EachEnvChunk_CarriesCursorWithDoneEnvsUpToThatPoint()
    {
        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["dev", "staging"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["dev"] = [MakeDeployment(1, "dev", daysAgo: 1)],
                ["staging"] = [MakeDeployment(2, "staging", daysAgo: 2)],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(1, "success", RunId, hoursAgo: 24)],
                [2] = [MakeStatus(2, "success", RunId + 1, hoursAgo: 48)],
            },
            workflowRunId: RunId);
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };

        var (runner, _) = BuildRunner(new FakeGithubHandler(urlMap), depth: 1);

        var chunkCursors = new List<GithubCursor>();
        await foreach (var chunk in runner.RunAsync(new GithubCursor(), CancellationToken.None))
            chunkCursors.Add(GithubCursor.Decode(chunk.Cursor));

        // Chunk 0 (dev env-done): backfill marker present with done_envs=[dev].
        var afterDev = chunkCursors[0];
        var markerAfterDev = afterDev.BackfillFor(FullRepo);
        Assert.NotNull(markerAfterDev);
        Assert.Contains("dev", markerAfterDev!.DoneEnvs);
        Assert.DoesNotContain("staging", markerAfterDev.DoneEnvs);

        // Chunk 1 (staging env-done): done_envs contains both.
        var afterStaging = chunkCursors[1];
        var markerAfterStaging = afterStaging.BackfillFor(FullRepo);
        Assert.NotNull(markerAfterStaging);
        Assert.Contains("dev", markerAfterStaging!.DoneEnvs);
        Assert.Contains("staging", markerAfterStaging.DoneEnvs);

        // Chunk 2 (completion marker): no backfill marker, repos[repo].since set.
        var completion = chunkCursors[2];
        Assert.False(completion.IsBackfilling);
        Assert.True(completion.Repos.ContainsKey(FullRepo));
    }

    // ── depth / no-progress / defer-YAML preserved with streaming ────────────

    [Fact]
    public async Task StreamingBackfill_PreservesDepthSemantics()
    {
        // Three deployments for same env/service. depth=2 → only 2 events emitted.
        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["prod"] = [
                    MakeDeployment(1, "prod", daysAgo: 1),
                    MakeDeployment(2, "prod", daysAgo: 2),
                    MakeDeployment(3, "prod", daysAgo: 3),
                ],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(1, "success", RunId, hoursAgo: 24)],
                [2] = [MakeStatus(2, "success", RunId + 1, hoursAgo: 48)],
                [3] = [MakeStatus(3, "success", RunId + 2, hoursAgo: 72)],
            },
            workflowRunId: RunId);
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 2}"] =
            new GhWorkflowRun { Id = RunId + 2, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };

        var (runner, _) = BuildRunner(new FakeGithubHandler(urlMap), depth: 2);

        var allEvents = new List<DeploymentEventIngest>();
        await foreach (var chunk in runner.RunAsync(new GithubCursor(), CancellationToken.None))
            allEvents.AddRange(chunk.Events);

        // depth=2 events total across all env-chunks.
        Assert.Equal(2, allEvents.Count);
        var ids = allEvents.Select(e => e.DeploymentId).ToHashSet();
        Assert.Contains("gh-deploy-1", ids);
        Assert.Contains("gh-deploy-2", ids);
        Assert.DoesNotContain("gh-deploy-3", ids);
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

    private static GhDeploymentStatus MakeStatus(long deployId, string state, long runId, int hoursAgo) =>
        new()
        {
            Id = deployId * 10,
            State = state,
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{runId}/jobs/1",
            CreatedAt = DateTimeOffset.UtcNow.AddHours(-hoursAgo),
        };

    private static GhWorkflow MakeWorkflow(string name) =>
        new()
        {
            Id = 1,
            Name = name,
            Path = ".github/workflows/deploy.yml",
            State = "active",
        };

    private const string WorkflowYaml = """
        name: Deploy API
        jobs:
          deploy-prod:
            environment: prod
            runs-on: ubuntu-latest
            steps: []
        """;

    private static Dictionary<string, object> BuildUrlMap(
        List<GhWorkflow> workflows,
        List<string> environments,
        Dictionary<string, List<GhDeployment>> deploymentsPerEnv,
        Dictionary<long, List<GhDeploymentStatus>> statusesById,
        long workflowRunId)
    {
        var yamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(WorkflowYaml));

        var map = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/workflows"] = new GhWorkflowListResponse { Workflows = workflows },
            [$"/repos/{Owner}/{Repo}/environments"] = new GhEnvironmentListResponse
            {
                Environments = environments.Select(e => new GhEnvironment { Name = e }).ToList(),
            },
            [$"/repos/{Owner}/{Repo}/actions/runs/{workflowRunId}"] = new GhWorkflowRun
            {
                Id = workflowRunId,
                Name = "Deploy API",
                Path = ".github/workflows/deploy.yml",
                HeadSha = "abc0001",
            },
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] = new GhWorkflowFileContent
            {
                Content = yamlBase64,
                Encoding = "base64",
            },
        };

        foreach (var (env, deploys) in deploymentsPerEnv)
        {
            // Build a multi-env YAML for the env if needed.
            map[$"/repos/{Owner}/{Repo}/deployments?environment={env}"] = deploys;
        }

        foreach (var (id, statuses) in statusesById)
            map[$"/repos/{Owner}/{Repo}/deployments/{id}/statuses"] = statuses;

        return map;
    }

    private static (BackfillRunner Runner, WorkflowGraphCache GraphCache) BuildRunner(
        HttpMessageHandler handler, int depth = 1)
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
            InitialLookback = TimeSpan.FromDays(30),
            BackfillMaxAge = TimeSpan.FromDays(30),
            BackfillDepth = depth,
        };

        var versionResolver = new VersionResolver(
            VersionSourceConfig.Default,
            graphCache,
            githubClient);

        var eventBuilder = new BackfillEventBuilder(
            githubClient, graphCache, versionResolver,
            NullLogger<BackfillEventBuilder>.Instance);

        var runner = new BackfillRunner(
            githubClient,
            adapterOptions,
            fetcherOptions,
            eventBuilder,
            NullLogger<BackfillRunner>.Instance);

        return (runner, graphCache);
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
                var json = JsonSerializer.Serialize(payload);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json"),
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

    private sealed class CountingFakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        public List<string> Calls { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";
            Calls.Add(path);
            var lookup = StripSuffix(path);

            if (urlMap.TryGetValue(lookup, out var payload))
            {
                var json = JsonSerializer.Serialize(payload);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json"),
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
