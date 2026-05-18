using Dashboard.Shared.Dto;
using Dashboard.Shared.Validation;

namespace Dashboard.Shared.Tests.Validation;

/// <summary>
/// CR-0008 § "Standardised error response shape": the validator emits
/// camelCase JSON field names as the error-map keys (not C# property names,
/// not snake_case). Every assertion in this file uses the wire-side
/// camelCase form because that is the contract the SPA + downstream
/// consumers see.
/// </summary>
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
        Assert.True(errors.ContainsKey("service"));
    }

    [Fact]
    public void UnknownStatus_IsInvalid()
    {
        var req = Valid() with { Status = "rolled-back" };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("status"));
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
        Assert.True(errors.ContainsKey("runUrl"));
    }

    [Fact]
    public void NegativeRunNumber_IsInvalid()
    {
        var req = Valid() with { RunNumber = -1 };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("runNumber"));
    }

    // ---- CR-0008 new rules: length caps + non-whitespace ----------------

    [Theory]
    [InlineData("deploymentId")]
    [InlineData("service")]
    [InlineData("environment")]
    [InlineData("version")]
    [InlineData("actor")]
    public void StringFieldOverLengthCap_IsInvalid_CamelCaseKey(string camelCaseField)
    {
        var tooLong = new string('a', 201);
        var req = camelCaseField switch
        {
            "deploymentId" => Valid() with { DeploymentId = tooLong },
            "service" => Valid() with { Service = tooLong },
            "environment" => Valid() with { Environment = tooLong },
            "version" => Valid() with { Version = tooLong },
            "actor" => Valid() with { Actor = tooLong },
            _ => throw new InvalidOperationException(),
        };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey(camelCaseField),
            $"expected camelCase key '{camelCaseField}', got: {string.Join(",", errors.Keys)}");
    }

    [Fact]
    public void RunUrlOver2048Chars_IsInvalid()
    {
        var huge = "https://example.com/" + new string('a', 2050);
        var req = Valid() with { RunUrl = huge };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("runUrl"));
    }

    [Fact]
    public void RefOver200Chars_IsInvalid()
    {
        // CR-0008 closes CR-0004 § Decision 10: ref cap is 200.
        var req = Valid() with { Ref = new string('r', 201) };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("ref"));
    }

    [Fact]
    public void ShaOver64Chars_IsInvalid()
    {
        // CR-0008 closes CR-0004 § Decision 10: sha cap is 64.
        var req = Valid() with { Sha = new string('a', 65) };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("sha"));
    }

    [Fact]
    public void RefWhitespaceOnly_IsInvalid_ButAbsentOrNullAreValid()
    {
        // Absence and explicit null are equivalent and valid (CR-0008
        // "Universal rules"). Whitespace-only is rejected.
        var (ok1, _) = DataAnnotationsValidator.Validate(Valid() with { Ref = null });
        Assert.True(ok1);

        var (ok2, errors) = DataAnnotationsValidator.Validate(Valid() with { Ref = "   " });
        Assert.False(ok2);
        Assert.True(errors.ContainsKey("ref"));
    }

    [Fact]
    public void ParentDeploymentsElementOverCap_ProducesPerIndexMessage()
    {
        // CR-0008 row `parent_deployments[i]`: per-element length cap = 200;
        // per-element messages include the index, and accumulate under the
        // single camelCase key `parentDeployments`.
        var parents = new[]
        {
            "good",
            "also-good",
            new string('x', 201), // index 2: too long
            "",                   // index 3: empty
        };
        var req = Valid() with { ParentDeployments = parents };
        var (ok, errors) = DataAnnotationsValidator.Validate(req);
        Assert.False(ok);
        Assert.True(errors.ContainsKey("parentDeployments"));
        var messages = errors["parentDeployments"];
        Assert.Contains(messages, m => m.Contains("[2]") && m.Contains("200 characters"));
        Assert.Contains(messages, m => m.Contains("[3]") && m.Contains("empty"));
    }

    [Fact]
    public void ParentDeploymentsEmptyArray_IsValid()
    {
        var req = Valid() with { ParentDeployments = Array.Empty<string>() };
        var (ok, _) = DataAnnotationsValidator.Validate(req);
        Assert.True(ok);
    }
}
