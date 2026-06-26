using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json.Serialization;
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
    [InlineData("pending")]
    [InlineData("queued")]
    [InlineData("in-progress")]
    [InlineData("waiting")]
    [InlineData("success")]
    [InlineData("failure")]
    [InlineData("cancelled")]
    [InlineData("rejected")]
    public void Validate_AllValidStatuses_NoStatusFailure(string status)
    {
        var failures = _validator.Validate(ValidBody() with { Status = status });
        Assert.DoesNotContain(failures, f => f.Pointer == "/status");
    }

    [Theory]
    [InlineData("SUCCESS")]
    [InlineData("In-Progress")]
    [InlineData("FAILURE")]
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
    public void Validate_ParentDeploymentsDuplicateItems_ReturnsParentFailure()
    {
        // spec: uniqueItems:true — duplicate entries must produce a 422.
        var body = ValidBody() with
        {
            ParentDeployments = ["gh-001", "gh-002", "gh-001"],
        };
        Assert.Contains(_validator.Validate(body), f => f.Pointer == "/parent_deployments");
    }

    [Fact]
    public void Validate_ParentDeployments_AllUniqueItems_NoFailure()
    {
        var body = ValidBody() with
        {
            ParentDeployments = ["gh-001", "gh-002", "gh-003"],
        };
        Assert.DoesNotContain(_validator.Validate(body), f => f.Pointer == "/parent_deployments");
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

    // ── ToJsonPointer drift guard ────────────────────────────────────────────
    // For every string property on DeploymentEventIngest that carries both
    // [JsonPropertyName] and [MaxLength], trigger a MaxLength violation and assert
    // the returned pointer equals "/" + [JsonPropertyName].Name.
    // This test MUST FAIL if a [JsonPropertyName] attribute is dropped (the pointer
    // would fall back to "/{CLR name}", e.g. "/DeploymentId" instead of "/deployment_id").

    public static IEnumerable<object[]> StringPropertiesWithJsonNameAndMaxLength()
    {
        foreach (var prop in typeof(DeploymentEventIngest).GetProperties())
        {
            var jsonAttr = prop.GetCustomAttribute<JsonPropertyNameAttribute>();
            var maxLenAttr = prop.GetCustomAttribute<MaxLengthAttribute>();
            if (jsonAttr is null || maxLenAttr is null) continue;
            // Nullable reference types (string?) share the same underlying type as string.
            if (prop.PropertyType != typeof(string)) continue;

            yield return [prop.Name, jsonAttr.Name, maxLenAttr.Length];
        }
    }

    [Theory]
    [MemberData(nameof(StringPropertiesWithJsonNameAndMaxLength))]
    public void Validate_StringPropertyExceedsMaxLength_PointerMatchesJsonPropertyName(
        string clrName, string expectedJsonName, int maxLength)
    {
        // Build a body with this one string property set to maxLength+1 chars.
        // All required fields are pre-filled via ValidBody(); we override via record with.
        var overlong = new string('x', maxLength + 1);
        var body = clrName switch
        {
            nameof(DeploymentEventIngest.DeploymentId) => ValidBody() with { DeploymentId = overlong },
            nameof(DeploymentEventIngest.Service) => ValidBody() with { Service = overlong },
            nameof(DeploymentEventIngest.Namespace) => ValidBody() with { Namespace = overlong },
            nameof(DeploymentEventIngest.Environment) => ValidBody() with { Environment = overlong },
            nameof(DeploymentEventIngest.Version) => ValidBody() with { Version = overlong },
            nameof(DeploymentEventIngest.RunUrl) => ValidBody() with { RunUrl = overlong },
            nameof(DeploymentEventIngest.RunNumber) => ValidBody() with { RunNumber = overlong },
            nameof(DeploymentEventIngest.Actor) => ValidBody() with { Actor = overlong },
            nameof(DeploymentEventIngest.Ref) => ValidBody() with { Ref = overlong },
            nameof(DeploymentEventIngest.Sha) => ValidBody() with { Sha = overlong },
            _ => throw new InvalidOperationException(
                $"Property '{clrName}' has [MaxLength] but is not handled in the drift-guard switch. " +
                "Update this test when DeploymentEventIngest gains a new string property."),
        };

        var expectedPointer = "/" + expectedJsonName;
        var failures = _validator.Validate(body);

        // xUnit Assert.Contains has no message overload; use True with a descriptive message instead.
        Assert.True(
            failures.Any(f => f.Pointer == expectedPointer),
            $"Expected pointer '{expectedPointer}' for CLR property '{clrName}' " +
            $"(json name: '{expectedJsonName}'). If this fails, check that [JsonPropertyName(\"{expectedJsonName}\")] " +
            $"is still on {nameof(DeploymentEventIngest)}.{clrName}.");
    }
}
