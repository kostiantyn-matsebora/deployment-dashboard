using System.Net;
using System.Text;
using Dashboard.Fetcher.Adapters.GitHubActions;
using Dashboard.Fetcher.Tests.Support;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests;

/// <summary>
/// Issue #19 + ADR-0007 — coverage for the correlation-edge emission the
/// GHA adapter performs against <see cref="Dashboard.Shared.Dto.DeploymentEventRequest.ParentDeployments"/>.
///
/// <para>Two edge types under test:</para>
/// <list type="bullet">
///   <item>Intra-run <c>needs:</c> edges — recovered from
///   <c>/actions/runs/{id}/jobs</c> + <c>/contents/.github/workflows/&lt;path&gt;</c>.</item>
///   <item>Per-env predecessor edges — recovered from the same
///   <c>/deployments</c> list call the adapter already issues.</item>
/// </list>
///
/// <para>Silent-degrade scenarios (404 on contents / jobs APIs, missing
/// job_id in the status URL, null status URL) are exercised alongside
/// the happy paths so the contract is locked.</para>
/// </summary>
public sealed class GitHubActionsAdapterCorrelationTests
{
    private const string BaseUrl = "https://api.github.com/";

    private static (GitHubActionsAdapter adapter, StubHttpHandler handler) Build()
    {
        var handler = new StubHttpHandler();
        var factory = new StubHttpClientFactory();
        factory.Register(GitHubActionsAdapter.HttpClientName, handler, BaseUrl);
        var adapter = new GitHubActionsAdapter(factory, NullLogger<GitHubActionsAdapter>.Instance);
        return (adapter, handler);
    }

    private static bool IsDeploymentsList(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.EndsWith("/deployments", StringComparison.Ordinal);

    private static bool IsDeploymentStatus(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/deployments/", StringComparison.Ordinal)
        && req.RequestUri.AbsolutePath.EndsWith("/statuses", StringComparison.Ordinal);

    private static bool IsRunJobs(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.EndsWith("/jobs", StringComparison.Ordinal)
        && req.RequestUri.AbsolutePath.Contains("/actions/runs/", StringComparison.Ordinal);

    /// <summary>
    /// Single-run GET (e.g. <c>/repos/o/r/actions/runs/12345</c>) — distinguished
    /// from the jobs sub-path by checking the last segment is purely numeric.
    /// </summary>
    private static bool IsRunGet(HttpRequestMessage req)
    {
        if (req.Method != HttpMethod.Get) return false;
        var path = req.RequestUri!.AbsolutePath;
        if (!path.Contains("/actions/runs/", StringComparison.Ordinal)) return false;
        var lastSeg = path.AsSpan(path.LastIndexOf('/') + 1);
        if (lastSeg.IsEmpty) return false;
        foreach (var c in lastSeg) if (c < '0' || c > '9') return false;
        return true;
    }

    private static bool IsContents(HttpRequestMessage req) =>
        req.Method == HttpMethod.Get && req.RequestUri!.AbsolutePath.Contains("/contents/", StringComparison.Ordinal);

    private static string ToBase64(string yaml)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(yaml));

    private static string ContentsJson(string yamlText) =>
        $"{{\"content\":\"{ToBase64(yamlText)}\",\"encoding\":\"base64\"}}";

    // ──────────────────────────────────────────────────────────────────────
    // Test 1: IntraRun `needs:` happy path — three jobs deploy-dev →
    // deploy-staging → deploy-prod chained via needs:; each subsequent
    // deployment carries the prior one as a parent.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task IntraRunNeeds_HappyPath_ChainedDeployJobs_EmitNeedsEdges()
    {
        var (adapter, handler) = Build();

        // Three deployments, one per env, all sharing the same workflow run id 9000.
        // GHA lists newest-first; we put prod (highest id) first.
        const string listJson = """
        [
          {"id": 33, "sha": "ccc1111", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:02:00Z", "creator": {"login": "deploy-bot"}},
          {"id": 32, "sha": "bbb1111", "ref": "main", "environment": "staging",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "deploy-bot"}},
          {"id": 31, "sha": "aaa1111", "ref": "main", "environment": "dev",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "deploy-bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);

        // Per-deployment status — each url points at /actions/runs/9000/job/{N}
        // FIFO matching (GHA adapter fetches in fresh-list order = ascending by id):
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/9000/job/101\",\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]"));
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/9000/job/102\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:30Z\"}]"));
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/9000/job/103\",\"target_url\":null,\"created_at\":\"2026-05-18T10:02:30Z\"}]"));

        // Single GET /actions/runs/9000 — caller needs path + head_sha.
        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":9000,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"sha-of-run\"}");

        // GET /actions/runs/9000/jobs — three jobs.
        handler.WhenJson(IsRunJobs, HttpStatusCode.OK, """
        {"jobs":[
          {"id":101,"name":"deploy-dev"},
          {"id":102,"name":"deploy-staging"},
          {"id":103,"name":"deploy-prod"}
        ]}
        """);

        // Workflow YAML with chained needs: deploy-prod ← deploy-staging ← deploy-dev
        const string workflowYaml = """
        name: deploy
        on: { push: { branches: [main] } }
        jobs:
          deploy-dev:
            runs-on: ubuntu-latest
            steps: [ { run: 'deploy dev' } ]
          deploy-staging:
            needs: deploy-dev
            runs-on: ubuntu-latest
            steps: [ { run: 'deploy staging' } ]
          deploy-prod:
            needs: [deploy-staging]
            runs-on: ubuntu-latest
            steps: [ { run: 'deploy prod' } ]
        """;
        handler.WhenJson(IsContents, HttpStatusCode.OK, ContentsJson(workflowYaml));

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Equal(3, page.Events.Count);
        // Emission order is ascending by id: 31 (dev), 32 (staging), 33 (prod).
        var dev = page.Events[0];
        var staging = page.Events[1];
        var prod = page.Events[2];

        Assert.Equal("gha-31", dev.DeploymentId);
        Assert.Equal("gha-32", staging.DeploymentId);
        Assert.Equal("gha-33", prod.DeploymentId);

        // dev has no needs → no intra-run edge; also no per-env predecessor in batch.
        Assert.NotNull(dev.ParentDeployments);
        Assert.Empty(dev.ParentDeployments!);

        // staging needs deploy-dev → parent is gha-31. No per-env predecessor
        // since dev and staging are in different envs.
        Assert.NotNull(staging.ParentDeployments);
        Assert.Equal(new[] { "gha-31" }, staging.ParentDeployments!);

        // prod needs deploy-staging → parent is gha-32.
        Assert.NotNull(prod.ParentDeployments);
        Assert.Equal(new[] { "gha-32" }, prod.ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 2: Cross-repo log_url — deployment in acme/posthog, log_url
    // points at acme/charts/actions/runs/.../job/...; the jobs API +
    // contents API MUST be called against acme/charts, not acme/posthog.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task CrossRepoLogUrl_JobsAndContents_GoToRunHostRepo_NotDeploymentRepo()
    {
        var (adapter, handler) = Build();

        const string listJson = """
        [
          {"id": 50, "sha": "deadbee", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/charts/actions/runs/12345/job/67890\",\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]");

        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":12345,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"abc\"}");
        handler.WhenJson(IsRunJobs, HttpStatusCode.OK,
            "{\"jobs\":[{\"id\":67890,\"name\":\"deploy\"}]}");
        handler.WhenJson(IsContents, HttpStatusCode.OK, ContentsJson("jobs:\n  deploy:\n    runs-on: ubuntu-latest"));

        var page = await adapter.FetchPageAsync("acme/posthog", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Single(page.Events);

        var runGet = handler.Requests.Single(r => IsRunGet(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.Contains("/acme/charts/actions/runs/12345", runGet.Uri.AbsolutePath, StringComparison.Ordinal);
        Assert.DoesNotContain("/acme/posthog/actions/runs/", runGet.Uri.AbsolutePath, StringComparison.Ordinal);

        var jobsGet = handler.Requests.Single(r => IsRunJobs(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.Contains("/acme/charts/actions/runs/12345/jobs", jobsGet.Uri.AbsolutePath, StringComparison.Ordinal);

        var contentsGet = handler.Requests.Single(r => IsContents(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.Contains("/acme/charts/contents/", contentsGet.Uri.AbsolutePath, StringComparison.Ordinal);
        Assert.DoesNotContain("/acme/posthog/contents/", contentsGet.Uri.AbsolutePath, StringComparison.Ordinal);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 3: Workflow YAML fetch failure (404) → no intra-run edges,
    // INFO log, cycle does NOT fail, per-env predecessor still emitted.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task WorkflowYamlFetch404_SilentSkip_PerEnvPredecessorStillEmitted()
    {
        var (adapter, handler) = Build();

        // Two deployments in prod -> the second has the first as per-env predecessor.
        const string listJson = """
        [
          {"id": 21, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 20, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/7000/job/1\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:30Z\"}]");
        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":7000,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"sha\"}");
        handler.WhenJson(IsRunJobs, HttpStatusCode.OK, "{\"jobs\":[{\"id\":1,\"name\":\"deploy\"}]}");
        // Contents API returns 404 — workflow YAML missing at this SHA (force-push).
        handler.WhenStatus(IsContents, HttpStatusCode.NotFound);

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);

        var first = page.Events[0];  // gha-20
        var second = page.Events[1]; // gha-21

        // First in env: no intra-run edge (silent skip), no per-env predecessor.
        Assert.Empty(first.ParentDeployments!);
        // Second in env: no intra-run edge (silent skip) but per-env predecessor IS there.
        Assert.Equal(new[] { "gha-20" }, second.ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 4: Jobs API failure (500) → same silent-skip contract.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task JobsApi500_SilentSkip_PerEnvPredecessorStillEmitted()
    {
        var (adapter, handler) = Build();

        const string listJson = """
        [
          {"id": 41, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 40, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/5000/job/1\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:30Z\"}]");
        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":5000,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"sha\"}");
        // Jobs API returns 500 — workflow run still indexing, GHA pages glitched, ...
        handler.WhenStatus(IsRunJobs, HttpStatusCode.InternalServerError);
        // Contents matcher is intentionally NOT registered — verifying the
        // adapter short-circuits before reaching the contents call when the
        // jobs API fails.

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);

        // First: empty edges. Second: per-env predecessor only.
        Assert.Empty(page.Events[0].ParentDeployments!);
        Assert.Equal(new[] { "gha-40" }, page.Events[1].ParentDeployments!);

        // Cycle didn't fail -- cursor advanced.
        Assert.Equal("41", page.NewCursor);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 5: Per-env predecessor happy path (within batch).
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PerEnvPredecessor_TwoConsecutiveProdDeploys_SecondLinksToFirst()
    {
        var (adapter, handler) = Build();

        const string listJson = """
        [
          {"id": 11, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 10, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // No run-host coords on the status URL → no intra-run edges,
        // pure per-env predecessor.
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        Assert.Equal(2, page.Events.Count);
        Assert.Empty(page.Events[0].ParentDeployments!); // gha-10 first in env → []
        Assert.Equal(new[] { "gha-11" }, new[] { page.Events[1].DeploymentId });
        Assert.Equal(new[] { "gha-10" }, page.Events[1].ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 6: First deployment in an env → empty array, NEVER null.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task FirstDeploymentInEnv_ParentDeploymentsIsEmptyArray_NotNull()
    {
        var (adapter, handler) = Build();

        const string listJson = """
        [
          {"id": 99, "sha": "abc", "ref": "main", "environment": "brand-new-env",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "alice"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // No status URL — no intra-run edges either.
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);

        var evt = Assert.Single(page.Events);
        Assert.NotNull(evt.ParentDeployments);
        Assert.Empty(evt.ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 7: Mixed edges -- intra-run needs:  AND per-env predecessor on
    // the same deployment. Both ids must appear (de-duplicated when equal).
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MixedEdges_IntraRunNeedsAndPerEnvPredecessor_BothEmittedAndDeduplicated()
    {
        var (adapter, handler) = Build();

        // Three deployments in env prod, all in the same workflow run.
        // jobs.deploy-prod-2.needs = deploy-prod-1; the chain is:
        // gha-60 (deploy-prod-1) ← gha-61 (deploy-prod-2)
        // Per-env predecessor: gha-61 → gha-60 (same env).
        // Both edges resolve to gha-60 → list must be de-duplicated to ["gha-60"].
        // Additionally we keep an env-staging job to guard sibling matching.
        const string listJson = """
        [
          {"id": 61, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:02:00Z", "creator": {"login": "bot"}},
          {"id": 60, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/8000/job/501\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:30Z\"}]"));
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/8000/job/502\",\"target_url\":null,\"created_at\":\"2026-05-18T10:02:30Z\"}]"));

        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":8000,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"sha\"}");
        handler.WhenJson(IsRunJobs, HttpStatusCode.OK, """
        {"jobs":[
          {"id":501,"name":"deploy-prod-1"},
          {"id":502,"name":"deploy-prod-2"}
        ]}
        """);
        const string workflowYaml = """
        jobs:
          deploy-prod-1:
            runs-on: ubuntu-latest
          deploy-prod-2:
            needs: deploy-prod-1
            runs-on: ubuntu-latest
        """;
        handler.WhenJson(IsContents, HttpStatusCode.OK, ContentsJson(workflowYaml));

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);

        var first = page.Events[0];   // gha-60
        var second = page.Events[1];  // gha-61

        Assert.Empty(first.ParentDeployments!);
        // Both intra-run needs: AND per-env predecessor resolve to gha-60;
        // result must contain exactly one entry (de-duplicated).
        Assert.Equal(new[] { "gha-60" }, second.ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 8: Null status URL — no intra-run edges (graceful skip), per-env
    // predecessor still emitted, no crash.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NullLogAndTargetUrl_NoIntraRunEdges_PerEnvPredecessorEmitted_NoCrash()
    {
        var (adapter, handler) = Build();
        const string listJson = """
        [
          {"id": 71, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 70, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":null,\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]");

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);
        Assert.Empty(page.Events[0].ParentDeployments!);
        Assert.Equal(new[] { "gha-70" }, page.Events[1].ParentDeployments!);

        // Assert: NO jobs / runs / contents calls were made.
        Assert.DoesNotContain(handler.Requests, r => r.Uri.AbsolutePath.Contains("/actions/runs/", StringComparison.Ordinal));
        Assert.DoesNotContain(handler.Requests, r => r.Uri.AbsolutePath.Contains("/contents/", StringComparison.Ordinal));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Test 9: Missing job_id in URL (PostHog real-world shape) — no
    // intra-run edges for that deployment, per-env predecessor still
    // emitted; jobs/contents APIs still get called (cache primes) but
    // no edge for this specific deployment since it can't be mapped.
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task MissingJobIdInStatusUrl_NoIntraRunEdgesForThatDeployment_PerEnvPredecessorEmitted()
    {
        var (adapter, handler) = Build();

        // Two deployments in prod, both linked to the same run, but the
        // status URLs lack the /job/{id} suffix (PostHog's real-world
        // shape per issue #19 §3 "Job-id absent case").
        const string listJson = """
        [
          {"id": 81, "sha": "bbb", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 80, "sha": "aaa", "ref": "main", "environment": "prod",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // Note: no /job/<id> suffix.
        handler.WhenJson(IsDeploymentStatus, HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/PostHog/charts/actions/runs/26129778612\",\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]");

        var page = await adapter.FetchPageAsync("PostHog/posthog", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);

        // No intra-run edges for either (mapping not derivable).
        // Per-env predecessor still wires the second deployment.
        Assert.Empty(page.Events[0].ParentDeployments!);
        Assert.Equal(new[] { "gha-80" }, page.Events[1].ParentDeployments!);

        // Importantly: no jobs / contents calls were made -- the adapter
        // short-circuited before reaching those endpoints because the
        // job-id wasn't in the URL (the index has no entries to populate).
        Assert.DoesNotContain(handler.Requests, r => IsRunGet(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.DoesNotContain(handler.Requests, r => IsRunJobs(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.DoesNotContain(handler.Requests, r => IsContents(new HttpRequestMessage(r.Method, r.Uri)));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Bonus: per-cycle cache -- two deployments in the same run only
    // trigger ONE jobs + contents call (cache hit on the second).
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task PerCycleCache_TwoDeploymentsSameRun_FetchesJobsAndContentsOnce()
    {
        var (adapter, handler) = Build();
        const string listJson = """
        [
          {"id": 91, "sha": "bbb", "ref": "main", "environment": "staging",
           "created_at": "2026-05-18T10:01:00Z", "creator": {"login": "bot"}},
          {"id": 90, "sha": "aaa", "ref": "main", "environment": "dev",
           "created_at": "2026-05-18T10:00:00Z", "creator": {"login": "bot"}}
        ]
        """;
        handler.WhenJson(IsDeploymentsList, HttpStatusCode.OK, listJson);
        // Both deployments belong to run 6000.
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/6000/job/1\",\"target_url\":null,\"created_at\":\"2026-05-18T10:00:30Z\"}]"));
        handler.EnqueueOnce(IsDeploymentStatus, () => StubHttpHandler.JsonResponse(HttpStatusCode.OK,
            "[{\"state\":\"success\",\"log_url\":\"https://github.com/acme/svc/actions/runs/6000/job/2\",\"target_url\":null,\"created_at\":\"2026-05-18T10:01:30Z\"}]"));

        handler.WhenJson(IsRunGet, HttpStatusCode.OK,
            "{\"id\":6000,\"path\":\".github/workflows/deploy.yml\",\"head_sha\":\"sha\"}");
        handler.WhenJson(IsRunJobs, HttpStatusCode.OK,
            "{\"jobs\":[{\"id\":1,\"name\":\"deploy-dev\"},{\"id\":2,\"name\":\"deploy-staging\"}]}");
        handler.WhenJson(IsContents, HttpStatusCode.OK, ContentsJson("jobs:\n  deploy-dev:\n    runs-on: ubuntu-latest\n  deploy-staging:\n    needs: deploy-dev\n    runs-on: ubuntu-latest"));

        var page = await adapter.FetchPageAsync("acme/svc", cursor: null, pageSize: 50, CancellationToken.None);
        Assert.Equal(2, page.Events.Count);

        // Run metadata fetched exactly once per distinct run id even
        // though two deployments share the run.
        Assert.Single(handler.Requests, r => IsRunGet(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.Single(handler.Requests, r => IsRunJobs(new HttpRequestMessage(r.Method, r.Uri)));
        Assert.Single(handler.Requests, r => IsContents(new HttpRequestMessage(r.Method, r.Uri)));

        // Edges: staging needs deploy-dev → parent = gha-90.
        Assert.Empty(page.Events[0].ParentDeployments!);
        Assert.Equal(new[] { "gha-90" }, page.Events[1].ParentDeployments!);
    }

    // ──────────────────────────────────────────────────────────────────────
    // URL parser + YAML parser behaviour is locked in *observably* via the
    // adapter integration tests above (role boundary: tests do not modify
    // production source to add InternalsVisibleTo -- see the existing
    // GitHubActionsAdapterTests cursor-parse comment for the same posture).
    // Scalar vs sequence `needs:` shape covered by happy-path tests 1 + 7;
    // YAML 404 / malformed → empty edges covered by tests 3 + 4. Job-id-
    // absent URL covered by test 9. Null log_url / target_url covered by
    // test 8. Cross-repo URL covered by test 2.
    // ──────────────────────────────────────────────────────────────────────
}
