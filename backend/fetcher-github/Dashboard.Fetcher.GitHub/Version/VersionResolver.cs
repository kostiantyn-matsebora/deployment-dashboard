using System.Text.Json;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.Models;

namespace Dashboard.Fetcher.GitHub.Version;

/// <summary>
/// Resolves the version field for a deployment event (§5.7, F15).
/// Returns null when the source yields nothing — no fallback, no truncation except sha.
/// Never throws; ingest is never blocked.
/// </summary>
public sealed class VersionResolver(
    VersionSourceConfig config,
    WorkflowGraphCache cache,
    GithubClient github)
{
    public async Task<string?> ResolveAsync(
        string owner, string repo,
        GhDeployment deployment, GhDeploymentStatus status,
        CancellationToken ct)
    {
        try
        {
            return config.Type switch
            {
                VersionSourceType.Attribute => ResolveAttribute(deployment),
                VersionSourceType.Payload   => ResolvePayload(deployment),
                VersionSourceType.Artifact  => await ResolveArtifactAsync(owner, repo, status, ct),
                _                           => null
            };
        }
        catch
        {
            return null;
        }
    }

    private string? ResolveAttribute(GhDeployment deployment)
    {
        var value = config.Key switch
        {
            "sha"         => deployment.Sha,
            "ref"         => deployment.Ref,
            "environment" => deployment.Environment,
            _             => null
        };

        if (value is null) return null;

        // sha → 7-char truncation; all other keys as-is (§5.7.1)
        return config.Key == "sha" && value.Length > 7 ? value[..7] : value;
    }

    private string? ResolvePayload(GhDeployment deployment)
    {
        if (deployment.Payload is not { ValueKind: JsonValueKind.Object } payload)
            return null;

        return payload.TryGetProperty(config.Key, out var prop) &&
               prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;
    }

    private async Task<string?> ResolveArtifactAsync(
        string owner, string repo, GhDeploymentStatus status, CancellationToken ct)
    {
        var runId = EventMapper.ExtractRunId(status.TargetUrl);
        if (runId is null)
            return null;

        return await cache.GetOrFetchArtifactAsync(
            owner, repo, runId.Value, config.Key, github, ct);
    }
}
