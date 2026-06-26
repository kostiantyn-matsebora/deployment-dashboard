using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Fetcher.GitHub.Models;

public sealed record GhDeployment
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("sha")] public string Sha { get; init; } = "";
    [JsonPropertyName("ref")] public string Ref { get; init; } = "";
    [JsonPropertyName("environment")] public string Environment { get; init; } = "";
    [JsonPropertyName("payload")] public JsonElement? Payload { get; init; }
    [JsonPropertyName("creator")] public GhActor? Creator { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset CreatedAt { get; init; }
}

public sealed record GhDeploymentStatus
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("state")] public string State { get; init; } = "";
    [JsonPropertyName("target_url")] public string? TargetUrl { get; init; }
    [JsonPropertyName("creator")] public GhActor? Creator { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset CreatedAt { get; init; }
}

public sealed record GhActor
{
    [JsonPropertyName("login")] public string Login { get; init; } = "";
}

public sealed record GhWorkflowRun
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    /// <summary>Stable numeric ID of the workflow definition (F12 / §5.6.2 — Actions:read, no Contents needed).</summary>
    [JsonPropertyName("workflow_id")] public long WorkflowId { get; init; }
    [JsonPropertyName("path")] public string Path { get; init; } = "";
    [JsonPropertyName("head_sha")] public string HeadSha { get; init; } = "";
    /// <summary>Run conclusion (e.g. "success", "failure", "cancelled", "timed_out", "skipped", null when still in progress).</summary>
    [JsonPropertyName("conclusion")] public string? Conclusion { get; init; }
}

/// <summary>One review entry from GET /repos/{owner}/{repo}/deployments/{id}/reviews.</summary>
public sealed record GhDeploymentReview
{
    /// <summary>"approved" or "rejected"</summary>
    [JsonPropertyName("state")] public string State { get; init; } = "";
}

public sealed record GhWorkflowFileContent
{
    [JsonPropertyName("content")] public string Content { get; init; } = "";  // Base64
    [JsonPropertyName("encoding")] public string Encoding { get; init; } = "";
}

public sealed record GhWorkflow
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("path")] public string Path { get; init; } = "";
    [JsonPropertyName("state")] public string State { get; init; } = "";
}

public sealed record GhWorkflowListResponse
{
    [JsonPropertyName("workflows")] public List<GhWorkflow> Workflows { get; init; } = [];
}

public sealed record GhEnvironment
{
    [JsonPropertyName("name")] public string Name { get; init; } = "";
}

public sealed record GhEnvironmentListResponse
{
    [JsonPropertyName("environments")] public List<GhEnvironment> Environments { get; init; } = [];
}

public sealed record GhArtifact
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("expired")] public bool Expired { get; init; }
}

public sealed record GhArtifactListResponse
{
    [JsonPropertyName("artifacts")] public List<GhArtifact> Artifacts { get; init; } = [];
}

/// <summary>
/// Minimal projection of a GitHub repository — only the fields needed for repo discovery.
/// Returned by <c>GET /user/repos</c>, <c>GET /orgs/{owner}/repos</c>, and
/// <c>GET /users/{owner}/repos</c>.
/// </summary>
public sealed record GhRepoItem
{
    [JsonPropertyName("full_name")] public string FullName { get; init; } = "";
}

public sealed record GhRateLimitResponse
{
    [JsonPropertyName("resources")] public GhRateLimitResources? Resources { get; init; }
}

public sealed record GhRateLimitResources
{
    [JsonPropertyName("core")] public GhRateLimitCore? Core { get; init; }
}

public sealed record GhRateLimitCore
{
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("remaining")] public int Remaining { get; init; }
    [JsonPropertyName("used")] public int Used { get; init; }
    [JsonPropertyName("reset")] public long Reset { get; init; }  // Unix epoch
}
