using Dashboard.Shared.Contracts;

namespace Dashboard.Shared.Tests;

public sealed class DeploymentStatusTests
{
    [Theory]
    [InlineData("in-progress")]
    [InlineData("success")]
    [InlineData("failure")]
    [InlineData("pending")]
    [InlineData("queued")]
    [InlineData("waiting")]
    [InlineData("cancelled")]
    [InlineData("rejected")]
    public void IsValid_KnownStatus_ReturnsTrue(string status) =>
        Assert.True(DeploymentStatus.IsValid(status));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("InProgress")]
    [InlineData("SUCCESS")]
    public void IsValid_UnknownOrNullStatus_ReturnsFalse(string? status) =>
        Assert.False(DeploymentStatus.IsValid(status));

    [Fact]
    public void Constants_MatchExpectedWireValues()
    {
        Assert.Equal("pending",    DeploymentStatus.Pending);
        Assert.Equal("queued",     DeploymentStatus.Queued);
        Assert.Equal("in-progress", DeploymentStatus.InProgress);
        Assert.Equal("waiting",    DeploymentStatus.Waiting);
        Assert.Equal("success",    DeploymentStatus.Success);
        Assert.Equal("failure",    DeploymentStatus.Failure);
        Assert.Equal("cancelled",  DeploymentStatus.Cancelled);
        Assert.Equal("rejected",   DeploymentStatus.Rejected);
    }

    [Fact]
    public void All_ContainsEightValues() =>
        Assert.Equal(8, DeploymentStatus.All.Count);

    [Theory]
    [InlineData("success",   true)]
    [InlineData("failure",   true)]
    [InlineData("cancelled", true)]
    [InlineData("rejected",  true)]
    [InlineData("in-progress", false)]
    [InlineData("pending",   false)]
    [InlineData("queued",    false)]
    [InlineData("waiting",   false)]
    public void IsTerminal_ReturnsExpected(string status, bool expected) =>
        Assert.Equal(expected, DeploymentStatus.IsTerminal(status));
}
