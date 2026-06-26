using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
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
/// Verifies that BackfillRunner derives parent_deployments using the FULL cross-environment
/// envToDeploymentId map, not a single-element map (the bug fixed in §5.6.4 / §5.8.2).
///
/// Scenario: one repo, one workflow run (run_id=100) deploying dev → staging → prod in a
/// linear chain. All three envs are seeded. Dev must have null parents; staging must resolve
/// dev's deployment id; prod must resolve staging's deployment id.
/// </summary>
public sealed class BackfillParentDerivationTests
{
    // ── constants ─────────────────────────────────────────────────────────────

    private const string Owner = "acme";
    private const string Repo = "api";
    private const string FullRepo = $"{Owner}/{Repo}";
    private const long RunId = 100L;

    // deployment ids — each env has its own GitHub deployment object
    private const long DevDeployId = 1L;
    private const long StagingDeployId = 2L;
    private const long ProdDeployId = 3L;

    // deployment status ids (one success status per deployment)
    private const long DevStatusId = 10L;
    private const long StagingStatusId = 20L;
    private const long ProdStatusId = 30L;

    // ── test ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Backfill_LinearChain_CrossEnvParentsResolvedCorrectly()
    {
        // Arrange
        var handler = new FakeGithubHandler(BuildUrlMap());
        var (runner, _) = BuildRunner(handler);

        // Act
        var (events, _) = await DrainAsync(runner);

        // Only success statuses are emitted (one per env × one status each)
        Assert.Equal(3, events.Count);

        var devEvent = events.Single(e => e.Environment == "dev");
        var stagingEvent = events.Single(e => e.Environment == "staging");
        var prodEvent = events.Single(e => e.Environment == "prod");

        // Dev is the root — no deployment ancestors
        Assert.Null(devEvent.ParentDeployments);

        // Staging's parent must be the dev deployment id (§5.6.5 + §5.6.4)
        Assert.NotNull(stagingEvent.ParentDeployments);
        Assert.Equal([$"gh-deploy-{DevDeployId}"], stagingEvent.ParentDeployments);

        // Prod's parent must be the staging deployment id
        Assert.NotNull(prodEvent.ParentDeployments);
        Assert.Equal([$"gh-deploy-{StagingDeployId}"], prodEvent.ParentDeployments);
    }

    // ── infrastructure ────────────────────────────────────────────────────────

    /// <summary>
    /// Builds all fake URL → JSON response mappings the backfill procedure will call.
    ///
    /// URL shape mirrors GithubClient.GetPagedAsync (adds ?per_page=100&amp;page=N) and
    /// GetAsync (no pagination suffix).  We key on URL prefix so the page=1 query is matched.
    /// </summary>
    private static Dictionary<string, object> BuildUrlMap()
    {
        var runUrl = $"https://github.com/{Owner}/{Repo}/actions/runs/{RunId}/jobs/1";

        // Timestamps — within the last 30 days so backfill cutoff does not exclude them
        var devCreated = DateTimeOffset.UtcNow.AddDays(-7);
        var stagingCreated = devCreated.AddMinutes(5);
        var prodCreated = devCreated.AddMinutes(10);

        var devStatusCreated = devCreated.AddMinutes(2);
        var stagingStatusCreated = stagingCreated.AddMinutes(2);
        var prodStatusCreated = prodCreated.AddMinutes(2);

        // ── Workflow YAML: dev → staging → prod linear chain ──────────────────
        const string workflowYaml = """
            name: Deploy API
            jobs:
              deploy-dev:
                environment: dev
                runs-on: ubuntu-latest
                steps: []
              deploy-staging:
                needs: deploy-dev
                environment: staging
                runs-on: ubuntu-latest
                steps: []
              deploy-prod:
                needs: deploy-staging
                environment: prod
                runs-on: ubuntu-latest
                steps: []
            """;

        var workflowYamlBase64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(workflowYaml));

        // ── GitHub model objects ───────────────────────────────────────────────

        var workflows = new GhWorkflowListResponse
        {
            Workflows =
            [
                new GhWorkflow { Id = 1, Name = "Deploy API", Path = ".github/workflows/deploy.yml", State = "active" }
            ]
        };

        var environments = new GhEnvironmentListResponse
        {
            Environments = [new GhEnvironment { Name = "dev" }, new GhEnvironment { Name = "staging" }, new GhEnvironment { Name = "prod" }]
        };

        // Deployments per environment (newest-first as GitHub returns them)
        var devDeployment = new GhDeployment { Id = DevDeployId, Sha = "abc0001", Ref = "main", Environment = "dev", CreatedAt = devCreated };
        var stagingDeployment = new GhDeployment { Id = StagingDeployId, Sha = "abc0001", Ref = "main", Environment = "staging", CreatedAt = stagingCreated };
        var prodDeployment = new GhDeployment { Id = ProdDeployId, Sha = "abc0001", Ref = "main", Environment = "prod", CreatedAt = prodCreated };

        // Statuses — each has target_url pointing to run_id=100
        var devStatus = new GhDeploymentStatus { Id = DevStatusId, State = "success", TargetUrl = runUrl, CreatedAt = devStatusCreated };
        var stagingStatus = new GhDeploymentStatus { Id = StagingStatusId, State = "success", TargetUrl = runUrl, CreatedAt = stagingStatusCreated };
        var prodStatus = new GhDeploymentStatus { Id = ProdStatusId, State = "success", TargetUrl = runUrl, CreatedAt = prodStatusCreated };

        // Workflow run metadata + file content
        var workflowRun = new GhWorkflowRun { Id = RunId, Name = "Deploy API", Path = ".github/workflows/deploy.yml", HeadSha = "abc0001" };
        var workflowFile = new GhWorkflowFileContent { Content = workflowYamlBase64, Encoding = "base64" };

        return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            // Workflow list
            [$"/repos/{Owner}/{Repo}/actions/workflows"] = workflows,

            // Environments
            [$"/repos/{Owner}/{Repo}/environments"] = environments,

            // Deployments per env (paged; page 1 covers all; no Link: next header → single page)
            [$"/repos/{Owner}/{Repo}/deployments?environment=dev"] = (object)new List<GhDeployment> { devDeployment },
            [$"/repos/{Owner}/{Repo}/deployments?environment=staging"] = new List<GhDeployment> { stagingDeployment },
            [$"/repos/{Owner}/{Repo}/deployments?environment=prod"] = new List<GhDeployment> { prodDeployment },

            // Deployment statuses
            [$"/repos/{Owner}/{Repo}/deployments/{DevDeployId}/statuses"] = new List<GhDeploymentStatus> { devStatus },
            [$"/repos/{Owner}/{Repo}/deployments/{StagingDeployId}/statuses"] = new List<GhDeploymentStatus> { stagingStatus },
            [$"/repos/{Owner}/{Repo}/deployments/{ProdDeployId}/statuses"] = new List<GhDeploymentStatus> { prodStatus },

            // Workflow run (for graph cache)
            [$"/repos/{Owner}/{Repo}/actions/runs/{RunId}"] = workflowRun,

            // Workflow file content
            [$"/repos/{Owner}/{Repo}/contents/.github/workflows/deploy.yml"] = workflowFile,
        };
    }

    // ── compatibility helper ──────────────────────────────────────────────────

    private static async Task<(List<DeploymentEventIngest> Events, GithubCursor FinalCursor)>
        DrainAsync(BackfillRunner runner, CancellationToken ct = default)
    {
        var events = new List<DeploymentEventIngest>();
        GithubCursor finalCursor = new();
        await foreach (var chunk in runner.RunAsync(new GithubCursor(), ct))
        {
            events.AddRange(chunk.Events);
            if (chunk.Cursor is not null)
                finalCursor = GithubCursor.Decode(chunk.Cursor);
        }
        return (events, finalCursor);
    }

    private static (BackfillRunner Runner, WorkflowGraphCache GraphCache) BuildRunner(
        FakeGithubHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };

        // Use a pre-configured limit so CreateAsync does NOT call GET /rate_limit
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
        };

        var versionResolver = new VersionResolver(
            VersionSourceConfig.Default,
            graphCache,
            githubClient);

        var eventBuilder = new BackfillEventBuilder(
            githubClient, graphCache, versionResolver,
            WorkflowExcludeFilter.PassAll, NullLogger<BackfillEventBuilder>.Instance);

        var runner = new BackfillRunner(
            githubClient,
            adapterOptions,
            fetcherOptions,
            eventBuilder,
            NullLogger<BackfillRunner>.Instance);

        return (runner, graphCache);
    }

    // ── fake HTTP handler ─────────────────────────────────────────────────────

    /// <summary>
    /// Matches requests by URL path prefix and returns the pre-baked JSON payload.
    /// Pagination: always returns an empty second page (no Link: next header on page 1
    /// is sufficient because GithubClient stops on empty page).
    /// </summary>
    private sealed class FakeGithubHandler(IReadOnlyDictionary<string, object> urlMap)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.PathAndQuery ?? "";

            // Strip the pagination suffix (per_page=100&page=N) for lookup.
            // The paged requests look like "/repos/.../deployments?environment=dev&per_page=100&page=1"
            // The map key is "/repos/.../deployments?environment=dev".
            var lookup = StripPaginationSuffix(path);

            if (urlMap.TryGetValue(lookup, out var payload))
            {
                var json = JsonSerializer.Serialize(payload);
                var response = new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(json, Encoding.UTF8, "application/json")
                };
                return Task.FromResult(response);
            }

            // Unrecognised URL → 404 (stops pagination / returns null from GetAsync)
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static string StripPaginationSuffix(string path)
        {
            // Remove &per_page=NNN&page=N or ?per_page=NNN&page=N appended by GetPagedAsync
            var idx = path.IndexOf("&per_page=", StringComparison.Ordinal);
            if (idx >= 0)
                return path[..idx];

            idx = path.IndexOf("?per_page=", StringComparison.Ordinal);
            if (idx >= 0)
                return path[..idx];

            // Also strip ?ref=... for workflow file content calls
            idx = path.IndexOf("?ref=", StringComparison.Ordinal);
            if (idx >= 0)
                return path[..idx];

            return path;
        }
    }
}
