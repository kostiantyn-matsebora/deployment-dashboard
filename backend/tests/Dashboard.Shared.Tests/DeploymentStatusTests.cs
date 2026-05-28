using Dashboard.Shared.Contracts;

namespace Dashboard.Shared.Tests;

public sealed class DeploymentStatusTests
{
    [Theory]
    [InlineData("in-progress")]
    [InlineData("success")]
    [InlineData("failure")]
    public void IsValid_KnownStatus_ReturnsTrue(string status) =>
        Assert.True(DeploymentStatus.IsValid(status));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("pending")]
    [InlineData("InProgress")]
    [InlineData("SUCCESS")]
    public void IsValid_UnknownOrNullStatus_ReturnsFalse(string? status) =>
        Assert.False(DeploymentStatus.IsValid(status));

    [Fact]
    public void Constants_MatchExpectedWireValues()
    {
        Assert.Equal("in-progress", DeploymentStatus.InProgress);
        Assert.Equal("success", DeploymentStatus.Success);
        Assert.Equal("failure", DeploymentStatus.Failure);
    }

    [Fact]
    public void All_ContainsExactlyThreeValues() =>
        Assert.Equal(3, DeploymentStatus.All.Count);
}
