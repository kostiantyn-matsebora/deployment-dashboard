using Dashboard.Shared.Contracts;
using Dashboard.Write.Filters;

namespace Dashboard.Write.Tests;

/// <summary>Unit tests for <see cref="ValidationEndpointFilter.Validate"/> — no HTTP stack needed.</summary>
public sealed class ValidationFilterTests
{
    private static DeploymentEventIngest ValidBody() => new()
    {
        DeploymentId = "gh-001",
        Service = "checkout-api",
        Environment = "prod",
        Status = "success",
        HappenedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public void Validate_ValidBody_ReturnsNoFailures() =>
        Assert.Empty(ValidationEndpointFilter.Validate(ValidBody()));

    [Theory]
    [InlineData("in-progress")]
    [InlineData("success")]
    [InlineData("failure")]
    public void Validate_AllValidStatuses_NoStatusFailure(string status)
    {
        var body = ValidBody() with { Status = status };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.DoesNotContain(failures, f => f.Pointer == "/status");
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("queued")]
    [InlineData("SUCCESS")]
    public void Validate_InvalidStatus_ReturnsStatusFailure(string status)
    {
        var body = ValidBody() with { Status = status };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.Contains(failures, f => f.Pointer == "/status");
    }

    [Fact]
    public void Validate_ParentDeployments32Items_NoFailure()
    {
        var body = ValidBody() with
        {
            ParentDeployments = Enumerable.Range(1, 32).Select(i => $"gh-{i:D3}").ToArray(),
        };
        Assert.Empty(ValidationEndpointFilter.Validate(body));
    }

    [Fact]
    public void Validate_ParentDeployments33Items_ReturnsParentFailure()
    {
        var body = ValidBody() with
        {
            ParentDeployments = Enumerable.Range(1, 33).Select(i => $"gh-{i:D3}").ToArray(),
        };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.Contains(failures, f => f.Pointer == "/parent_deployments");
    }

    [Fact]
    public void Validate_ServiceExceedsMaxLength_ReturnsServiceFailure()
    {
        var body = ValidBody() with { Service = new string('x', 129) };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.Contains(failures, f => f.Pointer == "/service");
    }

    [Fact]
    public void Validate_VersionExceedsMaxLength_ReturnsVersionFailure()
    {
        var body = ValidBody() with { Version = new string('v', 51) };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.Contains(failures, f => f.Pointer == "/version");
    }

    [Fact]
    public void Validate_NegativeRunNumber_ReturnsRunNumberFailure()
    {
        var body = ValidBody() with { RunNumber = -1 };
        var failures = ValidationEndpointFilter.Validate(body);
        Assert.Contains(failures, f => f.Pointer == "/run_number");
    }
}
