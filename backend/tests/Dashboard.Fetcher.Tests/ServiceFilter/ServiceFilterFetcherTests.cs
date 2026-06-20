using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Configuration;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Tests.ServiceFiltering;

/// <summary>
/// Tests that the fetcher correctly parses <c>GITHUB_WORKFLOW_EXCLUDE</c> into
/// <see cref="GithubAdapterOptions"/> and that the resulting <see cref="WorkflowExcludeFilter"/>
/// blocks/passes workflows at poll time using the three-segment (owner/repo/workflow) glob.
/// No mocks — all real implementations.
/// </summary>
public sealed class ServiceFilterFetcherTests
{
    // ── GithubAdapterOptionsEnv wires GITHUB_WORKFLOW_EXCLUDE ─────────────────

    [Fact]
    public void WorkflowExclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_WORKFLOW_EXCLUDE"] = "acme/*/legacy-*" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("acme/*/legacy-*", options.WorkflowExclude);
    }

    [Fact]
    public void WorkflowExclude_KeepsDefault_WhenAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.WorkflowExclude);
    }

    // ── BuildWorkflowExcludeFilter produces correct WorkflowExcludeFilter ──────

    [Fact]
    public void BuildWorkflowExcludeFilter_Empty_ProducesPassAllFilter()
    {
        var options = new GithubAdapterOptions();
        var filter = options.BuildWorkflowExcludeFilter();

        Assert.True(filter.IsEmpty);
        Assert.False(filter.IsExcluded("acme", "api", "any-workflow"));
    }

    [Fact]
    public void BuildWorkflowExcludeFilter_SingleSegment_ExcludesMatchingWorkflow()
    {
        var options = new GithubAdapterOptions { WorkflowExclude = "deploy" };
        var filter = options.BuildWorkflowExcludeFilter();

        Assert.True(filter.IsExcluded("acme", "api", "deploy"));
        Assert.False(filter.IsExcluded("acme", "api", "release"));
    }

    [Fact]
    public void BuildWorkflowExcludeFilter_ThreeSegment_ExcludesMatchingTriple()
    {
        var options = new GithubAdapterOptions { WorkflowExclude = "acme/web/legacy-*" };
        var filter = options.BuildWorkflowExcludeFilter();

        Assert.True(filter.IsExcluded("acme", "web", "legacy-deploy"));
        Assert.False(filter.IsExcluded("acme", "api", "legacy-deploy")); // different repo
        Assert.False(filter.IsExcluded("org-b", "web", "legacy-deploy")); // different owner
        Assert.False(filter.IsExcluded("acme", "web", "new-deploy"));
    }

    [Fact]
    public void BuildWorkflowExcludeFilter_MultiPattern_ExcludesAnyMatch()
    {
        var options = new GithubAdapterOptions { WorkflowExclude = "acme/*/canary,*/*/legacy" };
        var filter = options.BuildWorkflowExcludeFilter();

        Assert.True(filter.IsExcluded("acme", "api", "canary"));
        Assert.True(filter.IsExcluded("org-b", "web", "legacy"));
        Assert.False(filter.IsExcluded("acme", "api", "deploy"));
    }

    // ── WorkflowExcludeFilter 3-segment glob — each segment wildcard ───────────

    [Fact]
    public void WorkflowFilter_Empty_AllowsEverything()
    {
        var filter = WorkflowExcludeFilter.Parse(null);

        Assert.False(filter.IsExcluded("acme", "api", "deploy"));
        Assert.False(filter.IsExcluded("acme", "api", "legacy-crm"));
    }

    [Fact]
    public void WorkflowFilter_OwnerWildcard_ExcludesMatchingWorkflowInAnyOrg()
    {
        var filter = WorkflowExcludeFilter.Parse("*/web/deploy");

        Assert.True(filter.IsExcluded("acme", "web", "deploy"));
        Assert.True(filter.IsExcluded("org-b", "web", "deploy"));
        Assert.False(filter.IsExcluded("acme", "api", "deploy")); // different repo
    }

    [Fact]
    public void WorkflowFilter_RepoWildcard_ExcludesMatchingWorkflowInAnyRepo()
    {
        var filter = WorkflowExcludeFilter.Parse("acme/*/internal");

        Assert.True(filter.IsExcluded("acme", "web", "internal"));
        Assert.True(filter.IsExcluded("acme", "api", "internal"));
        Assert.False(filter.IsExcluded("org-b", "web", "internal")); // wrong owner
    }

    [Fact]
    public void WorkflowFilter_WorkflowGlob_ExcludesMatchingWorkflowName()
    {
        var filter = WorkflowExcludeFilter.Parse("acme/api/legacy-*");

        Assert.True(filter.IsExcluded("acme", "api", "legacy-deploy"));
        Assert.True(filter.IsExcluded("acme", "api", "legacy-release"));
        Assert.False(filter.IsExcluded("acme", "api", "deploy"));
    }

    [Fact]
    public void WorkflowFilter_ExactPattern_OnlyExcludesExactMatch()
    {
        var filter = WorkflowExcludeFilter.Parse("acme/api/deploy");

        Assert.True(filter.IsExcluded("acme", "api", "deploy"));
        Assert.False(filter.IsExcluded("acme", "api", "deploy-v2"));
        Assert.False(filter.IsExcluded("org-b", "api", "deploy"));
    }

    [Fact]
    public void WorkflowFilter_AllWildcard_ExcludesEverything()
    {
        var filter = WorkflowExcludeFilter.Parse("*/*/*");

        Assert.True(filter.IsExcluded("acme", "api", "deploy"));
        Assert.True(filter.IsExcluded("org-b", "web", "release"));
    }

    [Fact]
    public void WorkflowFilter_EmptyWorkflowExclude_IsEmpty_NoIngestionBlocked()
    {
        var filter = WorkflowExcludeFilter.Parse("");

        Assert.True(filter.IsEmpty);
        Assert.False(filter.IsExcluded("acme", "api", "any-workflow"));
    }

    [Fact]
    public void WorkflowFilter_NullWorkflowName_OnlyStarPatternMatches()
    {
        // When workflow name is empty (unavailable), only an all-'*' workflow segment matches.
        var filterAll = WorkflowExcludeFilter.Parse("*/*/*");
        var filterLiteral = WorkflowExcludeFilter.Parse("acme/api/deploy");

        Assert.True(filterAll.IsExcluded("acme", "api", ""));     // '*' matches empty
        Assert.False(filterLiteral.IsExcluded("acme", "api", "")); // literal won't match empty
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
