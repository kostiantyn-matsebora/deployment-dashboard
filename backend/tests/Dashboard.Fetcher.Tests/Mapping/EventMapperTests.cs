using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.Tests.Mapping;

public sealed class EventMapperTests
{
    private static readonly Dictionary<string, string> EmptyServiceMap = [];

    [Fact]
    public void Map_SetsDeploymentIdWithPrefix()
    {
        var (deployment, status) = MakeFixtures();
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, "Deploy API", null, [], EmptyServiceMap);

        Assert.Equal("gh-deploy-42", ev.DeploymentId);
    }

    [Fact]
    public void Map_UsesWorkflowNameAsService()
    {
        var (deployment, status) = MakeFixtures();
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, "My Workflow", null, [], EmptyServiceMap);

        Assert.Equal("My Workflow", ev.Service);
    }

    [Fact]
    public void Map_ExtractsRunNumberFromTargetUrl()
    {
        var (deployment, status) = MakeFixtures(targetUrl: "https://github.com/acme/api/actions/runs/99/jobs/1");
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, null, null, [], EmptyServiceMap);

        Assert.Equal("99", ev.RunNumber);
    }

    [Fact]
    public void Map_NullTargetUrl_RunNumberIsNull()
    {
        var (deployment, status) = MakeFixtures(targetUrl: null);
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, null, null, [], EmptyServiceMap);

        Assert.Null(ev.RunNumber);
    }

    [Fact]
    public void Map_ParentDeployments_PopulatedWhenNonEmpty()
    {
        var (deployment, status) = MakeFixtures();
        var parents = new[] { "gh-deploy-1", "gh-deploy-2" };
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.InProgress, null, null, parents, EmptyServiceMap);

        Assert.Equal(parents, ev.ParentDeployments);
    }

    [Fact]
    public void Map_EmptyParentDeployments_NullInContract()
    {
        var (deployment, status) = MakeFixtures();
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, null, null, [], EmptyServiceMap);

        Assert.Null(ev.ParentDeployments);
    }

    [Fact]
    public void Map_ActorPreferStatusCreator()
    {
        var deployment = new GhDeployment
        {
            Id = 1,
            Environment = "prod",
            Creator = new GhActor { Login = "deploy-bot" }
        };
        var status = new GhDeploymentStatus
        {
            State = "success",
            Creator = new GhActor { Login = "ci-user" },
            CreatedAt = DateTimeOffset.UtcNow
        };
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, null, null, [], EmptyServiceMap);

        Assert.Equal("ci-user", ev.Actor);
    }

    [Fact]
    public void Map_ActorFallsBackToDeploymentCreator_WhenStatusCreatorNull()
    {
        var deployment = new GhDeployment
        {
            Id = 1,
            Environment = "prod",
            Creator = new GhActor { Login = "deploy-bot" }
        };
        var status = new GhDeploymentStatus
        {
            State = "success",
            Creator = null,
            CreatedAt = DateTimeOffset.UtcNow
        };
        var ev = EventMapper.Map(deployment, status, "acme/api",
            DeploymentStatus.Success, null, null, [], EmptyServiceMap);

        Assert.Equal("deploy-bot", ev.Actor);
    }

    // ── ExtractRunId ──────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://github.com/acme/api/actions/runs/12345/jobs/1", 12345L)]
    [InlineData("https://github.com/acme/api/actions/runs/99", 99L)]
    public void ExtractRunId_ValidUrl_ReturnsRunId(string url, long expected)
    {
        Assert.Equal(expected, EventMapper.ExtractRunId(url));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("https://example.com/deploy")]
    public void ExtractRunId_InvalidUrl_ReturnsNull(string? url)
    {
        Assert.Null(EventMapper.ExtractRunId(url));
    }

    // ── fixtures ──────────────────────────────────────────────────────────────

    private static (GhDeployment, GhDeploymentStatus) MakeFixtures(string? targetUrl = "https://github.com/acme/api/actions/runs/7/jobs/1")
    {
        var deployment = new GhDeployment
        {
            Id = 42,
            Sha = "abc1234",
            Ref = "main",
            Environment = "prod",
            Creator = new GhActor { Login = "bot" },
            CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5)
        };
        var status = new GhDeploymentStatus
        {
            Id = 1,
            State = "success",
            TargetUrl = targetUrl,
            Creator = new GhActor { Login = "ci" },
            CreatedAt = DateTimeOffset.UtcNow
        };
        return (deployment, status);
    }
}
