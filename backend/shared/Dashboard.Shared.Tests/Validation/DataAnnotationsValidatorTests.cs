using Dashboard.Shared.Dto;
using Dashboard.Shared.Validation;

namespace Dashboard.Shared.Tests.Validation;

public sealed class DataAnnotationsValidatorTests
{
    private static DeploymentEventRequest Valid() => new()
    {
        DeploymentId = "gh-run-1247",
        Service = "web-portal",
        Environment = "dev",
        Version = "v2.3.1",
        Status = "success",
        RunUrl = "https://github.com/org/repo/actions/runs/1247",
        RunNumber = 1247,
        Actor = "john.doe",
    };

    [Fact]
    public void HappyPath_IsValid()
    {
        var (ok, errors) = DataAnnotationsValidator.Validate(Valid());
        Assert.True(ok);
        Assert.Empty(errors);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void MissingService_IsInvalid(string service)
    {
        var req = Valid() with { Service = service };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey(nameof(DeploymentEventRequest.Service)));
    }

    [Fact]
    public void UnknownStatus_IsInvalid()
    {
        var req = Valid() with { Status = "rolled-back" };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey(nameof(DeploymentEventRequest.Status)));
    }

    [Theory]
    [InlineData("in-progress")]
    [InlineData("success")]
    [InlineData("failure")]
    public void AllowedStatuses_AreAccepted(string status)
    {
        var req = Valid() with { Status = status };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.True(ok, string.Join("; ", errors.SelectMany(kv => kv.Value)));
    }

    [Fact]
    public void NonHttpRunUrl_IsInvalid()
    {
        var req = Valid() with { RunUrl = "not-a-url" };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey(nameof(DeploymentEventRequest.RunUrl)));
    }

    [Fact]
    public void NegativeRunNumber_IsInvalid()
    {
        var req = Valid() with { RunNumber = -1 };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey(nameof(DeploymentEventRequest.RunNumber)));
    }
}
