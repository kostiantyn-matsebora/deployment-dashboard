using Dashboard.Fetcher.GitHub.Backfill;

namespace Dashboard.Fetcher.Tests.Backfill;

public sealed class ServiceResolverTests
{
    [Fact]
    public void WorkflowLevelOverride_ReturnsOverrideValue()
    {
        var map = new Dictionary<string, string> { ["Deploy API"] = "api" };
        Assert.Equal("api", ServiceResolver.Resolve("Deploy API", "acme/api", map));
    }

    [Fact]
    public void RepoLevelOverride_AppliedWhenNoWorkflowMatch()
    {
        var map = new Dictionary<string, string> { ["acme/api"] = "my-api" };
        Assert.Equal("my-api", ServiceResolver.Resolve("Deploy Workflow", "acme/api", map));
    }

    [Fact]
    public void WorkflowLevelPrecedesRepoLevel()
    {
        var map = new Dictionary<string, string>
        {
            ["Deploy API"] = "workflow-override",
            ["acme/api"]   = "repo-override",
        };
        Assert.Equal("workflow-override", ServiceResolver.Resolve("Deploy API", "acme/api", map));
    }

    [Fact]
    public void Default_ReturnsWorkflowName_WhenNoMapEntry()
    {
        Assert.Equal("My Workflow", ServiceResolver.Resolve("My Workflow", "acme/api", new Dictionary<string, string>()));
    }

    [Fact]
    public void NonActionsFallback_ReturnsRepoShortName()
    {
        Assert.Equal("api", ServiceResolver.Resolve(null, "acme/api", new Dictionary<string, string>()));
    }

    [Fact]
    public void NullWorkflowName_RepoLevelOverride_AppliedBeforeFallback()
    {
        var map = new Dictionary<string, string> { ["acme/api"] = "override" };
        Assert.Equal("override", ServiceResolver.Resolve(null, "acme/api", map));
    }
}
