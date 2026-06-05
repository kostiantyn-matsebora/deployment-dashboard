using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.Tests.Mapping;

public sealed class StatusMapperTests
{
    [Theory]
    [InlineData("pending", DeploymentStatus.Pending)]
    [InlineData("queued", DeploymentStatus.Queued)]
    [InlineData("in_progress", DeploymentStatus.InProgress)]
    [InlineData("waiting", DeploymentStatus.Waiting)]
    [InlineData("success", DeploymentStatus.Success)]
    [InlineData("failure", DeploymentStatus.Failure)]
    [InlineData("error", DeploymentStatus.Failure)]
    public void Map_KnownState_ReturnsContractStatus(string state, string expected)
    {
        Assert.Equal(expected, StatusMapper.Map(state));
    }

    [Theory]
    [InlineData("inactive")]
    [InlineData("unknown")]
    [InlineData("")]
    public void Map_SkippedOrUnknown_ReturnsNull(string state)
    {
        Assert.Null(StatusMapper.Map(state));
    }
}
