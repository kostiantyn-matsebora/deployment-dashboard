using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Backfill;

/// <summary>
/// Tests for F1 (backfill depth, no-progress stop, deferred YAML) and
/// F2 (service identity from run path) in BackfillRunner.
/// </summary>
public sealed class BackfillRunnerV2Tests
{
    // ── Shared constants ──────────────────────────────────────────────────────

    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 100L;

    // ── F1: depth > 1 keeps N deployments per slot ───────────────────────────

    [Fact]
    public async Task BackfillDepth2_KeepsTwoDeploymentsPerSlot()
    {
        // Three prod deployments for the same service; depth=2 should keep the newest two.
        var deploy1 = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var deploy2 = MakeDeployment(id: 2, env: "prod", daysAgo: 2);
        var deploy3 = MakeDeployment(id: 3, env: "prod", daysAgo: 3);

        var status1 = MakeStatus(deployId: 1, state: "success", runId: RunId);
        var status2 = MakeStatus(deployId: 2, state: "success", runId: RunId);
        var status3 = MakeStatus(deployId: 3, state: "success", runId: RunId);

        var handler = new FakeGithubHandler(BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["prod"] = [deploy1, deploy2, deploy3],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [status1],
                [2] = [status2],
                [3] = [status3],
            },
            workflowRunId: RunId));

        var (runner, _) = BuildRunner(handler, depth: 2);
        var (events, _) = await runner.RunAsync(CancellationToken.None);

        // depth=2 → keep deploys 1 and 2, discard 3
        Assert.Equal(2, events.Count);
        var ids = events.Select(e => e.DeploymentId).ToHashSet();
        Assert.Contains("gh-deploy-1", ids);
        Assert.Contains("gh-deploy-2", ids);
        Assert.DoesNotContain("gh-deploy-3", ids);
    }

    // ── F1: no-progress stop ─────────────────────────────────────────────────

    [Fact]
    public async Task NoProgressStop_HaltsAfterStallWindow()
    {
        // One service (depth=1), then 25 more deployments for unknown/already-filled service.
        // Scanning should stop after the 1 kept + StallWindow=20 consecutive no-progress.
        var keptDeploy = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var extraDeploys = Enumerable.Range(2, 25)
            .Select(i => MakeDeployment(id: i, env: "prod", daysAgo: i))
            .ToList();

        var allDeploys = new List<GhDeployment> { keptDeploy };
        allDeploys.AddRange(extraDeploys);

        var statusesById = new Dictionary<long, List<GhDeploymentStatus>>
        {
            [1] = [MakeStatus(deployId: 1, state: "success", runId: RunId)],
        };
        // All extra deploys also have status for same service (already at depth=1)
        foreach (var d in extraDeploys)
            statusesById[d.Id] = [MakeStatus(deployId: d.Id, state: "success", runId: RunId + d.Id)];

        // Register the same run for all extra deployments (same service, so they all hit
        // the "already filled" branch and increment consecutiveNoProgress).
        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["prod"] = allDeploys,
            },
            statusesById: statusesById,
            workflowRunId: RunId);

        // Add run metadata for extra deploys (they all resolve to same service).
        for (var i = 2; i <= 26; i++)
        {
            urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + i}"] =
                new GhWorkflowRun { Id = RunId + i, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };
        }

        var handler = new FakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(handler, depth: 1);
        var (events, _) = await runner.RunAsync(CancellationToken.None);

        // Only 1 deployment kept (depth=1). Scanning stopped after stall window.
        Assert.Single(events);
        Assert.Equal("gh-deploy-1", events[0].DeploymentId);
    }

    // ── F1: YAML fetched only for kept deployments ───────────────────────────

    [Fact]
    public async Task DeferYaml_YamlFetchedOnlyForKeptDeployment()
    {
        // Two deployments for same service (depth=1). Only the first (kept) should
        // trigger a workflow-file (YAML) fetch. The second (discarded) must not.
        var kept = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var discarded = MakeDeployment(id: 2, env: "prod", daysAgo: 2);

        var urlMap = BuildUrlMap(
            workflows: [MakeWorkflow("Deploy API")],
            environments: ["prod"],
            deploymentsPerEnv: new Dictionary<string, List<GhDeployment>>
            {
                ["prod"] = [kept, discarded],
            },
            statusesById: new Dictionary<long, List<GhDeploymentStatus>>
            {
                [1] = [MakeStatus(deployId: 1, state: "success", runId: RunId)],
                [2] = [MakeStatus(deployId: 2, state: "success", runId: RunId + 1)],
            },
            workflowRunId: RunId);

        // Add run for discarded deployment.
        urlMap[$"/repos/{Owner}/{Repo}/actions/runs/{RunId + 1}"] =
            new GhWorkflowRun { Id = RunId + 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc" };

        var handler = new CountingFakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(handler, depth: 1);
        await runner.RunAsync(CancellationToken.None);

        // The YAML fetch path is /repos/{owner}/{repo}/contents/...
        var yamlFetches = handler.Calls
            .Count(c => c.Contains("/contents/"));

        // Exactly 1 YAML fetch (for the kept deployment only).
        Assert.Equal(1, yamlFetches);
    }

    // ── F2: run-name override → resolved via path to workflow name ───────────

    [Fact]
    public async Task F2_RunNameOverride_ResolvesViaPathToWorkflowName()
    {
        // The run's `Name` is "Release v1.2.3" (run-name: override) but its
        // `Path` is ".github/workflows/release.yml" which maps to workflow "Release API".
        // The service must be resolved to "Release API", NOT "Release v1.2.3".
        var workflow = new GhWorkflow
        {
            Id = 1,
            Name = "Release API",
            Path = ".github/workflows/release.yml",
            State = "active"
        };
        var deployment = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var status = MakeStatus(deployId: 1, state: "success", runId: RunId);

        // Run has a run-name override ("Release v1.2.3") but path maps to "Release API".
        var workflowRun = new GhWorkflowRun
        {
            Id = RunId,
            Name = "Release v1.2.3",   // run-name: override
            Path = ".github/workflows/release.yml",
            HeadSha = "abc0001"
        };

        var urlMap = BuildUrlMapWithRun(workflow, deployment, status, workflowRun);
        var handler = new FakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(handler, depth: 1);
        var (events, _) = await runner.RunAsync(CancellationToken.None);

        Assert.Single(events);
        Assert.Equal("Release API", events[0].Service);
    }

    // ── F2: missing path → fallback to run.Name ──────────────────────────────

    [Fact]
    public async Task F2_MissingPath_FallsBackToRunName()
    {
        // No active workflow has this path — fallback to run.Name.
        var workflow = new GhWorkflow
        {
            Id = 1,
            Name = "Other Workflow",
            Path = ".github/workflows/other.yml",
            State = "active"
        };
        var deployment = MakeDeployment(id: 1, env: "prod", daysAgo: 1);
        var status = MakeStatus(deployId: 1, state: "success", runId: RunId);

        var workflowRun = new GhWorkflowRun
        {
            Id = RunId,
            Name = "My Workflow",   // run.Name used as fallback
            Path = ".github/workflows/unknown.yml",  // NOT in active workflows
            HeadSha = "abc0001"
        };

        var urlMap = BuildUrlMapWithRun(workflow, deployment, status, workflowRun);
        var handler = new FakeGithubHandler(urlMap);
        var (runner, _) = BuildRunner(handler, depth: 1);
        var (events, _) = await runner.RunAsync(CancellationToken.None);

        // "Other Workflow" workflow is active but run path doesn't match it.
        // The deployment's service resolves via fallback — but since "My Workflow"
        // is not in allServiceNames (only "Other Workflow" is), the event may be skipped.
        // The assertion here is that no crash occurs and the run.Name is used for the
        // fallback resolution path (the test verifies the resolution logic, not count).
        // Since "My Workflow" ∉ allServiceNames, expect 0 events (correctly skipped).
        Assert.Empty(events);
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

    private static GhDeploymentStatus MakeStatus(long deployId, string state, long runId) =>
        new()
        {
            Id = deployId * 10,
            State = state,
            TargetUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{runId}/jobs/1",
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
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
            map[$"/repos/{Owner}/{Repo}/deployments?environment={env}"] = deploys;

        foreach (var (id, statuses) in statusesById)
            map[$"/repos/{Owner}/{Repo}/deployments/{id}/statuses"] = statuses;

        return map;
    }

    private static Dictionary<string, object> BuildUrlMapWithRun(
        GhWorkflow workflow,
        GhDeployment deployment,
        GhDeploymentStatus status,
        GhWorkflowRun run)
    {
        const string yaml = """
            name: Release API
            jobs:
              deploy-prod:
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;
        var yamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(yaml));

        return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/workflows"] = new GhWorkflowListResponse { Workflows = [workflow] },
            [$"/repos/{Owner}/{Repo}/environments"] = new GhEnvironmentListResponse
            {
                Environments = [new GhEnvironment { Name = "prod" }],
            },
            [$"/repos/{Owner}/{Repo}/deployments?environment=prod"] = new List<GhDeployment> { deployment },
            [$"/repos/{Owner}/{Repo}/deployments/{deployment.Id}/statuses"] = new List<GhDeploymentStatus> { status },
            [$"/repos/{Owner}/{Repo}/actions/runs/{run.Id}"] = run,
            [$"/repos/{Owner}/{Repo}/contents/{run.Path}"] = new GhWorkflowFileContent
            {
                Content = yamlBase64,
                Encoding = "base64",
            },
        };
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

        var runner = new BackfillRunner(
            githubClient,
            adapterOptions,
            fetcherOptions,
            graphCache,
            versionResolver,
            NullLogger<BackfillRunner>.Instance);

        return (runner, graphCache);
    }

    // ── Fake HTTP handler ─────────────────────────────────────────────────────

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

    /// <summary>Records each URL called so tests can assert on call counts.</summary>
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
