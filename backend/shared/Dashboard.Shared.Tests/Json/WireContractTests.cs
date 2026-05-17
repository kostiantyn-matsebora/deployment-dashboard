using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Queries;

namespace Dashboard.Shared.Tests.Json;

/// <summary>
/// Wire-format guards. These pin the JSON keys the SPA reads
/// (<c>docs/ui/deployment-dashboard.html</c>) so any accidental rename in the
/// DTOs breaks the build, not the frontend in production.
/// </summary>
public sealed class WireContractTests
{
    private static int _nextId;

    private static DeploymentEntity Evt(
        string s, string e, string v, string status, DateTime at,
        string? @ref = null, string? sha = null) =>
        new()
        {
            Id = 1,
            DeploymentId = $"wc-{Interlocked.Increment(ref _nextId)}",
            Service = s,
            Environment = e,
            Version = v,
            Status = status,
            RunUrl = "https://example.com/runs/1",
            RunNumber = 1247,
            Actor = "john.doe",
            DeployedAt = DateTime.SpecifyKind(at, DateTimeKind.Utc),
            Ref = @ref,
            Sha = sha,
        };

    [Fact]
    public void DeploymentEventResponse_SerialisesSnakeCaseFields()
    {
        var dto = DeploymentEventResponse.FromEntity(
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success, new DateTime(2026, 5, 14, 12, 30, 0)));

        var json = JsonSerializer.Serialize(dto, DashboardJson.Options);

        Assert.Contains("\"run_url\":", json);
        Assert.Contains("\"run_number\":", json);
        Assert.Contains("\"deployed_at\":", json);
        // Sanity: no accidental camelCase regressions.
        Assert.DoesNotContain("\"runUrl\"", json);
        Assert.DoesNotContain("\"runNumber\"", json);
        Assert.DoesNotContain("\"deployedAt\"", json);
    }

    [Fact]
    public void DeploymentEventResponse_EmitsRefAndShaAsLowercaseSnakeCaseKeys()
    {
        // SAD §7 + FR-05: wire-format keys are "ref" and "sha" (lower
        // snake_case, single token). Always emit per chosen convention —
        // null when the column is null.
        var withBoth = DeploymentEventResponse.FromEntity(
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,
                new DateTime(2026, 5, 14, 12, 30, 0),
                @ref: "feature/login-revamp",
                sha: "9f1c0d2e8a"));

        var json = JsonSerializer.Serialize(withBoth, DashboardJson.Options);
        Assert.Contains("\"ref\":\"feature/login-revamp\"", json);
        Assert.Contains("\"sha\":\"9f1c0d2e8a\"", json);
        // Sanity: belt-and-braces against accidental camelCase / PascalCase regressions.
        Assert.DoesNotContain("\"Ref\"", json);
        Assert.DoesNotContain("\"Sha\"", json);

        // Always-emit convention: both keys must be present even when the
        // backing values are null.
        var withNeither = DeploymentEventResponse.FromEntity(
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,
                new DateTime(2026, 5, 14, 12, 30, 0)));
        var nullJson = JsonSerializer.Serialize(withNeither, DashboardJson.Options);
        Assert.Contains("\"ref\":null", nullJson);
        Assert.Contains("\"sha\":null", nullJson);
    }

    [Fact]
    public void MatrixSlot_CurrentAndLastSuccessful_CarryRefAndSha()
    {
        // SAD §7 "Matrix response shape" lists ref and sha on both
        // `current` and `lastSuccessful`. The mockup-aligned example in the
        // SAD shows them explicitly on both, including null on
        // lastSuccessful.
        var events = new[]
        {
            Evt("web-portal", "dev", "v2.3.2", DeploymentStatus.InProgress,
                new DateTime(2026, 5, 14, 14, 34, 0),
                @ref: "feature/login-revamp", sha: "9f1c0d2e8a"),
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,
                new DateTime(2026, 5, 14, 12, 30, 0)),
        };

        var matrix = MatrixQuery.BuildFromEvents(events.OrderByDescending(e => e.DeployedAt));
        var json = JsonSerializer.Serialize(matrix, DashboardJson.Options);

        // current carries populated ref/sha
        Assert.Contains("\"ref\":\"feature/login-revamp\"", json);
        Assert.Contains("\"sha\":\"9f1c0d2e8a\"", json);
        // lastSuccessful exists and carries null ref/sha (the SAD JSON example)
        Assert.Contains("\"lastSuccessful\":", json);
    }

    [Fact]
    public void MatrixSlot_SerialisesExpectedShape_PerSADExample()
    {
        // SAD §7 "Matrix response shape per slot" — current/lastSuccessful/previousFailed.
        var events = new[]
        {
            Evt("web-portal", "dev", "v2.3.2", DeploymentStatus.InProgress, new DateTime(2026, 5, 14, 14, 34, 0)),
            Evt("web-portal", "dev", "v2.3.1", DeploymentStatus.Success,    new DateTime(2026, 5, 14, 12, 30, 0)),
        };

        var matrix = MatrixQuery.BuildFromEvents(events.OrderByDescending(e => e.DeployedAt));
        var json = JsonSerializer.Serialize(matrix, DashboardJson.Options);

        Assert.Contains("\"web-portal\"", json);
        Assert.Contains("\"dev\"", json);
        Assert.Contains("\"current\":", json);
        Assert.Contains("\"lastSuccessful\":", json);
        Assert.Contains("\"previousFailed\":", json);
        // Slot keys (lastSuccessful / previousFailed) must remain camelCase
        // even though the wire policy is snake_case — JsonPropertyName
        // overrides the policy.
        Assert.DoesNotContain("\"last_successful\"", json);
        Assert.DoesNotContain("\"previous_failed\"", json);
    }
}
