using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Graph;

/// <summary>
/// Tests for §5.6.2 / F12: service identity is resolved via
/// <c>GET /repos/{o}/{r}/actions/workflows/{workflow_id}</c> (Actions:read, no Contents permission).
///
/// Three scenarios:
///   1. Workflows endpoint returns a name → identity uses that name, not the YAML name: field.
///   2. Contents fetch returns 403 → identity is still stable; parent_deployments = [].
///   3. Contents fetch returns 200 → parent_deployments populated from the needs graph.
/// </summary>
public sealed class WorkflowGraphCacheIdentityTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const long RunId = 42L;
    private const long WorkflowId = 7L;

    // ── Scenario 1: identity from workflows endpoint ──────────────────────────

    /// <summary>
    /// When the workflows endpoint returns a name, WorkflowGraph.WorkflowName must equal
    /// that name — NOT the YAML name: field — so identity is stable without Contents:read.
    /// </summary>
    [Fact]
    public async Task GetOrFetchGraph_IdentityFromWorkflowsEndpoint_NotYamlName()
    {
        const string workflowEndpointName = "Deploy API (stable)";
        const string yamlName = "Deploy API (yaml override)";

        var run = new GhWorkflowRun
        {
            Id = RunId,
            WorkflowId = WorkflowId,
            Name = "run-name override",
            Path = ".github/workflows/deploy.yml",
            HeadSha = "abc123",
            Conclusion = "success",
        };
        var workflow = new GhWorkflow { Id = WorkflowId, Name = workflowEndpointName, Path = ".github/workflows/deploy.yml", State = "active" };

        var yaml = MakeYaml(yamlName);
        var handler = new MapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = run,
            [$"/repos/{Owner}/{Repo}/actions/workflows/{WorkflowId}"] = workflow,
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] = MakeFileContent(yaml),
        });

        var (cache, client) = Build(handler);
        var graph = await cache.GetOrFetchGraphAsync(Owner, Repo, RunId, client, default);

        Assert.NotNull(graph);
        Assert.Equal(workflowEndpointName, graph.WorkflowName);
        // YAML name: is different — must NOT leak into identity.
        Assert.NotEqual(yamlName, graph.WorkflowName);
    }

    /// <summary>
    /// When the workflows endpoint is unavailable (404), identity falls back to run.Name,
    /// and then to the repo short name if run.Name is also null.
    /// </summary>
    [Fact]
    public async Task GetOrFetchGraph_WorkflowsEndpointFails_FallsBackToRunName()
    {
        var run = new GhWorkflowRun
        {
            Id = RunId,
            WorkflowId = WorkflowId,
            Name = "Run Name Fallback",
            Path = ".github/workflows/deploy.yml",
            HeadSha = "abc123",
            Conclusion = "success",
        };

        // Workflows endpoint returns 404 (no entry in map).
        var handler = new MapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = run,
            // Workflows endpoint absent → 404 → fallback to run.Name.
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] = MakeFileContent(MakeYaml("YAML Name")),
        });

        var (cache, client) = Build(handler);
        var graph = await cache.GetOrFetchGraphAsync(Owner, Repo, RunId, client, default);

        Assert.NotNull(graph);
        Assert.Equal("Run Name Fallback", graph.WorkflowName);
    }

    /// <summary>
    /// When both the workflows endpoint and run.Name are unavailable, identity falls back to
    /// the repo short name ("api" from "acme/api").
    /// </summary>
    [Fact]
    public async Task GetOrFetchGraph_WorkflowsEndpointAndRunNameMissing_FallsBackToRepoShortName()
    {
        var run = new GhWorkflowRun
        {
            Id = RunId,
            WorkflowId = WorkflowId,
            Name = null,                // run.Name absent
            Path = ".github/workflows/deploy.yml",
            HeadSha = "abc123",
            Conclusion = "success",
        };

        // Neither the workflows endpoint nor run.Name is available.
        var handler = new MapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = run,
            // Workflows endpoint absent, no contents.
        });

        var (cache, client) = Build(handler);
        var graph = await cache.GetOrFetchGraphAsync(Owner, Repo, RunId, client, default);

        Assert.NotNull(graph);
        Assert.Equal(Repo, graph.WorkflowName);  // repo short name = "api"
    }

    // ── Scenario 2: contents 403 → identity stable, parents empty ────────────

    /// <summary>
    /// When GET /contents returns 403 (Contents permission not granted), the graph is
    /// returned with the stable identity from the workflows endpoint and an empty job graph
    /// (parent_deployments = [] for all events).  Ingest must never be blocked (F10 / §5.5).
    /// </summary>
    [Fact]
    public async Task GetOrFetchGraph_ContentsForbidden_IdentityStableParentsEmpty()
    {
        const string workflowEndpointName = "Deploy API";

        var run = new GhWorkflowRun
        {
            Id = RunId,
            WorkflowId = WorkflowId,
            Name = "run-name-do-not-use",
            Path = ".github/workflows/deploy.yml",
            HeadSha = "abc123",
            Conclusion = "success",
        };
        var workflow = new GhWorkflow { Id = WorkflowId, Name = workflowEndpointName, Path = ".github/workflows/deploy.yml", State = "active" };

        // Contents endpoint returns 403.
        var handler = new MapHandler(
            new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = run,
                [$"/repos/{Owner}/{Repo}/actions/workflows/{WorkflowId}"] = workflow,
            },
            forbiddenPaths: new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                $"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml",
            });

        var (cache, client) = Build(handler);
        var graph = await cache.GetOrFetchGraphAsync(Owner, Repo, RunId, client, default);

        // Identity is stable despite contents failure.
        Assert.NotNull(graph);
        Assert.Equal(workflowEndpointName, graph.WorkflowName);

        // Job graph is empty → parent_deployments = [] for all events.
        Assert.Empty(graph.AllJobs);
        Assert.Empty(graph.DeploymentJobs);
    }

    // ── Scenario 3: contents 200 → parents populated ──────────────────────────

    /// <summary>
    /// When GET /contents succeeds, the deployment-job subgraph is parsed and parent edges
    /// are populated.  The WorkflowName is still the workflows-endpoint name (F12).
    /// </summary>
    [Fact]
    public async Task GetOrFetchGraph_ContentsSuccess_ParentsPopulatedIdentityFromWorkflowEndpoint()
    {
        const string workflowEndpointName = "Deploy API";

        var run = new GhWorkflowRun
        {
            Id = RunId,
            WorkflowId = WorkflowId,
            Name = "run-name",
            Path = ".github/workflows/deploy.yml",
            HeadSha = "abc123",
            Conclusion = "success",
        };
        var workflow = new GhWorkflow { Id = WorkflowId, Name = workflowEndpointName, Path = ".github/workflows/deploy.yml", State = "active" };

        // Workflow with two deployment jobs: staging → prod (needs).
        const string yaml = """
            name: Deploy API
            jobs:
              deploy-staging:
                environment: staging
                runs-on: ubuntu-latest
                steps: []
              deploy-prod:
                environment: prod
                needs: [deploy-staging]
                runs-on: ubuntu-latest
                steps: []
            """;

        var handler = new MapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = run,
            [$"/repos/{Owner}/{Repo}/actions/workflows/{WorkflowId}"] = workflow,
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] = MakeFileContent(yaml),
        });

        var (cache, client) = Build(handler);
        var graph = await cache.GetOrFetchGraphAsync(Owner, Repo, RunId, client, default);

        Assert.NotNull(graph);

        // Identity from workflows endpoint (not YAML name:).
        Assert.Equal(workflowEndpointName, graph.WorkflowName);

        // Subgraph is populated — deployment jobs exist.
        Assert.NotEmpty(graph.DeploymentJobs);
        Assert.True(graph.DeploymentJobs.ContainsKey("deploy-staging"));
        Assert.True(graph.DeploymentJobs.ContainsKey("deploy-prod"));

        // prod job has staging as a need → parent edge can be derived.
        var prodJob = graph.DeploymentJobs["deploy-prod"];
        Assert.Contains("deploy-staging", prodJob.Needs);
    }

    // ── GetOrFetchWorkflowNameAsync public API ────────────────────────────────

    /// <summary>
    /// GetOrFetchWorkflowNameAsync returns null when workflowId == 0 (field absent in JSON).
    /// </summary>
    [Fact]
    public async Task GetOrFetchWorkflowName_WorkflowIdZero_ReturnsNull()
    {
        var handler = new MapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase));
        var (cache, client) = Build(handler);

        var name = await cache.GetOrFetchWorkflowNameAsync(Owner, Repo, workflowId: 0, client, default);

        Assert.Null(name);
    }

    /// <summary>
    /// GetOrFetchWorkflowNameAsync caches the result — the workflows endpoint is called once
    /// even when the method is called twice with the same workflowId.
    /// </summary>
    [Fact]
    public async Task GetOrFetchWorkflowName_ResultCached_EndpointCalledOnce()
    {
        var workflow = new GhWorkflow { Id = WorkflowId, Name = "Deploy API", Path = ".github/workflows/deploy.yml", State = "active" };

        var handler = new CountingMapHandler(new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            [$"/repos/{Owner}/{Repo}/actions/workflows/{WorkflowId}"] = workflow,
        });

        var (cache, client) = Build(handler);

        var first = await cache.GetOrFetchWorkflowNameAsync(Owner, Repo, WorkflowId, client, default);
        var second = await cache.GetOrFetchWorkflowNameAsync(Owner, Repo, WorkflowId, client, default);

        Assert.Equal("Deploy API", first);
        Assert.Equal("Deploy API", second);

        var workflowPath = $"/repos/{Owner}/{Repo}/actions/workflows/{WorkflowId}";
        Assert.Equal(1, handler.CountFor(workflowPath));
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    private static (WorkflowGraphCache Cache, GithubClient Client) Build(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var budget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();
        return (new WorkflowGraphCache(), new GithubClient(httpClient, budget));
    }

    private static GhWorkflowFileContent MakeFileContent(string yaml) =>
        new() { Content = Convert.ToBase64String(Encoding.UTF8.GetBytes(yaml)), Encoding = "base64" };

    private static string MakeYaml(string name) => $"""
        name: {name}
        jobs:
          deploy:
            environment: prod
            runs-on: ubuntu-latest
            steps: []
        """;

    /// <summary>Simple URL-map handler; returns 403 for paths in <c>forbiddenPaths</c>.</summary>
    private sealed class MapHandler(
        IReadOnlyDictionary<string, object> urlMap,
        HashSet<string>? forbiddenPaths = null)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = StripQuery(request.RequestUri?.PathAndQuery ?? "");

            if (forbiddenPaths?.Contains(path) is true)
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Forbidden));

            if (urlMap.TryGetValue(path, out var payload))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                });

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static string StripQuery(string path)
        {
            foreach (var marker in new[] { "?per_page=", "&per_page=", "?ref=" })
            {
                var idx = path.IndexOf(marker, StringComparison.Ordinal);
                if (idx >= 0) return path[..idx];
            }
            return path;
        }
    }

    /// <summary>Records call counts per URL path so tests can assert cache-hit behaviour.</summary>
    private sealed class CountingMapHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        private readonly Dictionary<string, int> _counts = new(StringComparer.OrdinalIgnoreCase);

        public int CountFor(string path) => _counts.GetValueOrDefault(path, 0);

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = StripQuery(request.RequestUri?.PathAndQuery ?? "");

            _counts.TryGetValue(path, out var count);
            _counts[path] = count + 1;

            if (urlMap.TryGetValue(path, out var payload))
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                });

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static string StripQuery(string path)
        {
            foreach (var marker in new[] { "?per_page=", "&per_page=", "?ref=" })
            {
                var idx = path.IndexOf(marker, StringComparison.Ordinal);
                if (idx >= 0) return path[..idx];
            }
            return path;
        }
    }
}
