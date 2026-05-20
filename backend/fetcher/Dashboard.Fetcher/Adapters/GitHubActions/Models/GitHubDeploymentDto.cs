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

// ──────────────────────────────────────────────────────────────────────
// Issue #19 + ADR-0007 + CR-0009 §3d: intra-run `needs:` recovery DTOs.
// Adapter calls /actions/runs/{id} (for workflow path + head sha),
// /actions/runs/{id}/jobs (for job ids ↔ job names), and
// /repos/{o}/{r}/contents/{path}?ref={sha} (for YAML to parse `needs:`).
// All three are silent-degrade on any failure (no edges, INFO log,
// cycle does not fail).
// ──────────────────────────────────────────────────────────────────────

/// <summary>
/// Wire-shape DTO for GHA
/// <c>GET /repos/{owner}/{repo}/actions/runs/{run_id}</c>. The adapter
/// only consumes the workflow YAML path + head SHA — both are needed to
/// fetch the workflow contents at the *exact* revision that produced the
/// run (a YAML edit on <c>main</c> after the run completed must NOT
/// change the `needs:` we attribute to the run).
/// </summary>
internal sealed record GitHubWorkflowRunDto
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    /// <summary>Repo-relative path to the workflow YAML (e.g. <c>.github/workflows/deploy.yml</c>).</summary>
    [JsonPropertyName("path")]
    public string Path { get; init; } = string.Empty;

    /// <summary>Commit SHA the workflow ran against — used as the <c>ref</c> for the contents API call.</summary>
    [JsonPropertyName("head_sha")]
    public string HeadSha { get; init; } = string.Empty;
}

/// <summary>
/// Wire-shape DTO for GHA
/// <c>GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs</c> — bridges
/// the deployment's parsed <c>job_id</c> to a stable <c>job_name</c> that
/// can be matched against the workflow YAML's <c>jobs.&lt;name&gt;.needs:</c>
/// declaration.
/// </summary>
internal sealed record GitHubRunJobsDto
{
    [JsonPropertyName("jobs")]
    public IReadOnlyList<GitHubRunJobDto> Jobs { get; init; } = Array.Empty<GitHubRunJobDto>();
}

internal sealed record GitHubRunJobDto
{
    [JsonPropertyName("id")]
    public long Id { get; init; }

    [JsonPropertyName("name")]
    public string Name { get; init; } = string.Empty;
}

/// <summary>
/// Wire-shape DTO for GHA
/// <c>GET /repos/{owner}/{repo}/contents/{path}?ref={sha}</c>. The
/// payload is the workflow YAML, base64-encoded — the adapter decodes it
/// in memory and hands the text to <see cref="WorkflowYamlParser"/>.
/// </summary>
internal sealed record GitHubContentsDto
{
    /// <summary>Base64-encoded file content. GHA inserts <c>\n</c> every 60 chars; standard base64 decoders tolerate this.</summary>
    [JsonPropertyName("content")]
    public string? Content { get; init; }

    /// <summary>Always <c>"base64"</c> for blobs &lt; 1 MiB; for larger blobs GHA returns the empty string (caller must silent-degrade).</summary>
    [JsonPropertyName("encoding")]
    public string? Encoding { get; init; }
}
