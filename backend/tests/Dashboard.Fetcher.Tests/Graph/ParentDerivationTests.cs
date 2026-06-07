using Dashboard.Fetcher.GitHub.Graph;

namespace Dashboard.Fetcher.Tests.Graph;

public sealed class ParentDerivationTests
{
    // ── FindParentDeploymentJobIds ─────────────────────────────────────────────

    [Fact]
    public void LinearChain_DevStagingProd_ProdParentIsStaging()
    {
        var (all, deploy) = BuildGraph(new[]
        {
            ("dev",     "dev",     (string?)null),
            ("staging", "staging", "dev"),
            ("prod",    "prod",    "staging"),
        });

        var parents = ParentDerivation.FindParentDeploymentJobIds(deploy["prod"], deploy, all);

        Assert.Equal(["staging"], parents);
    }

    [Fact]
    public void NonDeploymentIntermediary_LookedThrough()
    {
        var build = new WorkflowJob("build", null, []);
        var devJob = new WorkflowJob("deploy-dev", "dev", ["build"]);
        var all = new Dictionary<string, WorkflowJob>
        {
            ["build"] = build,
            ["deploy-dev"] = devJob,
        };
        var deploy = new Dictionary<string, WorkflowJob> { ["deploy-dev"] = devJob };

        // no parents — build is non-deployment intermediary with no deployment ancestors
        var parents = ParentDerivation.FindParentDeploymentJobIds(devJob, deploy, all);

        Assert.Empty(parents);
    }

    [Fact]
    public void NonDeploymentIntermediary_BetweenTwoDeployJobs_ReturnsUpstreamDeploy()
    {
        var devJob = new WorkflowJob("deploy-dev", "dev", []);
        var test = new WorkflowJob("test", null, ["deploy-dev"]);
        var prodJob = new WorkflowJob("deploy-prod", "prod", ["test"]);
        var all = new Dictionary<string, WorkflowJob>
        {
            ["deploy-dev"] = devJob,
            ["test"] = test,
            ["deploy-prod"] = prodJob,
        };
        var deploy = new Dictionary<string, WorkflowJob>
        {
            ["deploy-dev"] = devJob,
            ["deploy-prod"] = prodJob,
        };

        var parents = ParentDerivation.FindParentDeploymentJobIds(prodJob, deploy, all);

        Assert.Equal(["deploy-dev"], parents);
    }

    [Fact]
    public void ParallelBranches_JobHasNoDeploymentAncestor_ReturnsEmpty()
    {
        var (all, deploy) = BuildGraph(new[]
        {
            ("deploy-eu", "eu", (string?)null),
            ("deploy-us", "us", (string?)null),
        });

        var parents = ParentDerivation.FindParentDeploymentJobIds(deploy["deploy-eu"], deploy, all);

        Assert.Empty(parents);
    }

    [Fact]
    public void NoMatchingDeploymentJob_ReturnsEmpty()
    {
        var job = new WorkflowJob("build", null, []);
        var parents = ParentDerivation.FindParentDeploymentJobIds(
            job, new Dictionary<string, WorkflowJob>(), new Dictionary<string, WorkflowJob>());

        Assert.Empty(parents);
    }

    [Fact]
    public void CycleInNeeds_DoesNotInfiniteLoop()
    {
        var a = new WorkflowJob("a", "envA", ["b"]);
        var b = new WorkflowJob("b", null, ["a"]);
        var all = new Dictionary<string, WorkflowJob> { ["a"] = a, ["b"] = b };
        var deploy = new Dictionary<string, WorkflowJob> { ["a"] = a };

        // Should terminate without exception
        var parents = ParentDerivation.FindParentDeploymentJobIds(a, deploy, all);
        Assert.Empty(parents);
    }

    // ── BuildEnvToDeploymentIdMap ─────────────────────────────────────────────

    [Fact]
    public void BuildEnvMap_SingleEntry_MapsCorrectly()
    {
        var entries = new (long, string, DateTimeOffset, long?)[]
        {
            (100L, "prod", DateTimeOffset.UtcNow, 55L)
        };

        var map = ParentDerivation.BuildEnvToDeploymentIdMap(entries);

        Assert.Equal("gh-deploy-100", map[55L]["prod"]);
    }

    [Fact]
    public void BuildEnvMap_Collision_KeepsLatestCreatedAt()
    {
        var older = DateTimeOffset.UtcNow.AddHours(-1);
        var newer = DateTimeOffset.UtcNow;
        var entries = new (long, string, DateTimeOffset, long?)[]
        {
            (10L, "prod", older, 7L),
            (11L, "prod", newer, 7L),   // newer → should win
        };

        var map = ParentDerivation.BuildEnvToDeploymentIdMap(entries);

        Assert.Equal("gh-deploy-11", map[7L]["prod"]);
    }

    [Fact]
    public void BuildEnvMap_NullRunId_Skipped()
    {
        var entries = new (long, string, DateTimeOffset, long?)[]
        {
            (1L, "dev", DateTimeOffset.UtcNow, null)
        };

        var map = ParentDerivation.BuildEnvToDeploymentIdMap(entries);

        Assert.Empty(map);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// <summary>Builds all/deploy dictionaries from (jobId, environment?, needs?) tuples.</summary>
    private static (Dictionary<string, WorkflowJob> All, Dictionary<string, WorkflowJob> Deploy)
        BuildGraph(IEnumerable<(string Id, string? Env, string? Needs)> jobs)
    {
        var all = jobs.ToDictionary(
            j => j.Id,
            j => new WorkflowJob(j.Id, j.Env, j.Needs is null ? [] : [j.Needs]));

        var deploy = all.Values
            .Where(j => j.Environment is not null)
            .ToDictionary(j => j.Id);

        return (all, deploy);
    }
}
