using Dashboard.Shared.Contracts;
using Dashboard.Write.Validation;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="IngestValidator"/> — no HTTP stack needed.
/// </summary>
public sealed class IngestValidatorTests
{
    private readonly IngestValidator _validator = new();

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
        Assert.Empty(_validator.Validate(ValidBody()));

    [Theory]
    [InlineData("in-progress")]
    [InlineData("success")]
    [InlineData("failure")]
    public void Validate_AllValidStatuses_NoStatusFailure(string status)
    {
        var failures = _validator.Validate(ValidBody() with { Status = status });
        Assert.DoesNotContain(failures, f => f.Pointer == "/status");
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("queued")]
    [InlineData("SUCCESS")]
    public void Validate_InvalidStatus_ReturnsStatusFailure(string status)
    {
        var failures = _validator.Validate(ValidBody() with { Status = status });
        Assert.Contains(failures, f => f.Pointer == "/status");
    }

    [Fact]
    public void Validate_ParentDeployments32Items_NoFailure()
    {
        var body = ValidBody() with
        {
            ParentDeployments = Enumerable.Range(1, 32).Select(i => $"gh-{i:D3}").ToArray(),
        };
        Assert.Empty(_validator.Validate(body));
    }

    [Fact]
    public void Validate_ParentDeployments33Items_ReturnsParentFailure()
    {
        var body = ValidBody() with
        {
            ParentDeployments = Enumerable.Range(1, 33).Select(i => $"gh-{i:D3}").ToArray(),
        };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/parent_deployments");
    }

    [Fact]
    public void Validate_ServiceExceedsMaxLength_ReturnsServiceFailure()
    {
        var body = ValidBody() with { Service = new string('x', 129) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/service");
    }

    [Fact]
    public void Validate_VersionExceedsMaxLength_ReturnsVersionFailure()
    {
        var body = ValidBody() with { Version = new string('v', 51) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/version");
    }

    [Fact]
    public void Validate_RunNumberExceedsMaxLength_ReturnsRunNumberFailure()
    {
        var body = ValidBody() with { RunNumber = new string('x', 129) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/run_number");
    }

    // ── ToJsonPointer branch coverage ────────────────────────────────────────

    [Fact]
    public void Validate_DeploymentIdExceedsMaxLength_ReturnsDeploymentIdFailure()
    {
        var body = ValidBody() with { DeploymentId = new string('x', 201) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/deployment_id");
    }

    [Fact]
    public void Validate_EnvironmentExceedsMaxLength_ReturnsEnvironmentFailure()
    {
        var body = ValidBody() with { Environment = new string('x', 65) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/environment");
    }

    [Fact]
    public void Validate_RunUrlExceedsMaxLength_ReturnsRunUrlFailure()
    {
        var body = ValidBody() with { RunUrl = new string('x', 2049) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/run_url");
    }

    [Fact]
    public void Validate_ActorExceedsMaxLength_ReturnsActorFailure()
    {
        var body = ValidBody() with { Actor = new string('x', 129) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/actor");
    }

    [Fact]
    public void Validate_RefExceedsMaxLength_ReturnsRefFailure()
    {
        var body = ValidBody() with { Ref = new string('x', 257) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/ref");
    }

    [Fact]
    public void Validate_ShaExceedsMaxLength_ReturnsShaFailure()
    {
        var body = ValidBody() with { Sha = new string('x', 129) };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/sha");
    }
}
