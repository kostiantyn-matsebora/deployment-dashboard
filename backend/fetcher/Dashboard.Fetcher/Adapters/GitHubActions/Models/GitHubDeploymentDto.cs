using System.Text.Json.Serialization;

namespace Dashboard.Fetcher.Adapters.GitHubActions.Models;

/// <summary>
/// Internal wire-shape DTO for GitHub REST API
/// <c>GET /repos/{owner}/{repo}/deployments</c>. Only the fields the adapter
/// actually consumes are surfaced; the rest are ignored on deserialisation.
/// Intentionally internal — the canonical event shape is
/// <c>Dashboard.Shared.Dto.DeploymentEventRequest</c>; this type exists only
/// to bridge GHA's payload into that DTO.
/// </summary>
internal sealed record GitHubDeploymentDto
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("sha")]
    public string? Sha { get; init; }

    [JsonPropertyName("ref")]
    public string? Ref { get; init; }

    [JsonPropertyName("environment")]
    public string Environment { get; init; } = string.Empty;

    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; init; }

    [JsonPropertyName("creator")]
    public GitHubUserDto? Creator { get; init; }
}

internal sealed record GitHubUserDto
{
    [JsonPropertyName("login")]
    public string? Login { get; init; }
}

/// <summary>
/// Wire-shape DTO for GHA
/// <c>GET /repos/{owner}/{repo}/deployments/{id}/statuses</c>.
/// </summary>
internal sealed record GitHubDeploymentStatusDto
{
    [JsonPropertyName("state")]
    public string State { get; init; } = string.Empty;

    [JsonPropertyName("log_url")]
    public string? LogUrl { get; init; }

    [JsonPropertyName("target_url")]
    public string? TargetUrl { get; init; }

    [JsonPropertyName("created_at")]
    public DateTimeOffset CreatedAt { get; init; }
}
