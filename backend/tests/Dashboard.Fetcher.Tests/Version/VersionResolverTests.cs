using System.Text.Json;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.Version;

namespace Dashboard.Fetcher.Tests.Version;

public sealed class VersionResolverTests
{
    // ── attribute type ────────────────────────────────────────────────────────

    [Fact]
    public async Task Attribute_Sha_TruncatesToSevenChars()
    {
        var resolver = MakeResolver("attribute:sha");
        var deployment = MakeDeployment(sha: "abcdef1234567890");
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Equal("abcdef1", version);
    }

    [Fact]
    public async Task Attribute_Sha_ShortSha_ReturnedAsIs()
    {
        var resolver = MakeResolver("attribute:sha");
        var deployment = MakeDeployment(sha: "abc");
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Equal("abc", version);
    }

    [Fact]
    public async Task Attribute_Ref_ReturnsValueAsIs()
    {
        var resolver = MakeResolver("attribute:ref");
        var deployment = MakeDeployment(refValue: "refs/heads/main");
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Equal("refs/heads/main", version);
    }

    [Fact]
    public async Task Attribute_UnknownKey_ReturnsNull()
    {
        var resolver = MakeResolver("attribute:unknown_field");
        var deployment = MakeDeployment();
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Null(version);
    }

    // ── payload type ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Payload_ExistingField_ReturnsValue()
    {
        var resolver = MakeResolver("payload:version");
        var payload = JsonSerializer.SerializeToElement(new { version = "1.2.3" });
        var deployment = MakeDeployment(payload: payload);
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Equal("1.2.3", version);
    }

    [Fact]
    public async Task Payload_FieldAbsent_ReturnsNull()
    {
        var resolver = MakeResolver("payload:missing");
        var payload = JsonSerializer.SerializeToElement(new { other = "x" });
        var deployment = MakeDeployment(payload: payload);
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Null(version);
    }

    [Fact]
    public async Task Payload_NotAnObject_ReturnsNull()
    {
        var resolver = MakeResolver("payload:version");
        var payload = JsonSerializer.SerializeToElement("just a string");
        var deployment = MakeDeployment(payload: payload);
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Null(version);
    }

    [Fact]
    public async Task Payload_NullPayload_ReturnsNull()
    {
        var resolver = MakeResolver("payload:version");
        var deployment = MakeDeployment(payload: null);
        var status = MakeStatus();

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Null(version);
    }

    // ── artifact type ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Artifact_NoRunId_ReturnsNull()
    {
        var resolver = MakeResolver("artifact:version.txt");
        var deployment = MakeDeployment();
        var status = MakeStatus(targetUrl: "https://example.com/not-actions");

        var version = await resolver.ResolveAsync("o", "r", deployment, status, default);

        Assert.Null(version);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static VersionResolver MakeResolver(string config) =>
        new(VersionSourceConfig.Parse(config),
            new Fetcher.GitHub.Graph.WorkflowGraphCache(),
            null!);   // GithubClient unused for attribute/payload tests

    private static GhDeployment MakeDeployment(
        string sha = "abc1234",
        string refValue = "main",
        JsonElement? payload = null) =>
        new()
        {
            Id = 1, Sha = sha, Ref = refValue,
            Environment = "prod",
            Payload = payload,
            CreatedAt = DateTimeOffset.UtcNow
        };

    private static GhDeploymentStatus MakeStatus(
        string targetUrl = "https://github.com/acme/api/actions/runs/5/jobs/1") =>
        new()
        {
            Id = 1, State = "success",
            TargetUrl = targetUrl,
            CreatedAt = DateTimeOffset.UtcNow
        };
}
