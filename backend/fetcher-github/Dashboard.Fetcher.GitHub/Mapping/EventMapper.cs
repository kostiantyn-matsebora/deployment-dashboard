using System.Text.RegularExpressions;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.GitHub.Mapping;

/// <summary>Maps a (GhDeployment, GhDeploymentStatus) pair to DeploymentEventIngest (§5.2).</summary>
/// <summary>Maps a (GhDeployment, GhDeploymentStatus) pair to DeploymentEventIngest (§5.2).</summary>
public static partial class EventMapper
{
    [GeneratedRegex(@"/actions/runs/(\d+)", RegexOptions.Compiled)]
    private static partial Regex RunIdRegex();

    private static readonly Regex RunIdPattern = RunIdRegex();

    public static DeploymentEventIngest Map(
        GhDeployment deployment,
        GhDeploymentStatus status,
        string repo,
        string contractStatus,
        EventMappingContext context)
    {
        var runId = ExtractRunId(status.TargetUrl);
        var service = ServiceResolver.Resolve(context.WorkflowName, repo, context.ServiceMap);

        return new DeploymentEventIngest
        {
            DeploymentId = $"gh-deploy-{deployment.Id}",
            Service = service,
            Environment = deployment.Environment,
            Version = context.Version,
            Status = contractStatus,
            HappenedAt = status.CreatedAt,
            RunUrl = status.TargetUrl,
            RunNumber = runId?.ToString(),
            Actor = status.Creator?.Login ?? deployment.Creator?.Login,
            Ref = deployment.Ref,
            Sha = deployment.Sha,
            ParentDeployments = context.ParentDeployments.Length > 0 ? context.ParentDeployments : null,
        };
    }

    public static long? ExtractRunId(string? targetUrl)
    {
        if (targetUrl is null) return null;
        var match = RunIdPattern.Match(targetUrl);
        return match.Success && long.TryParse(match.Groups[1].Value, out var id) ? id : null;
    }
}

/// <summary>Contextual enrichment data for <see cref="EventMapper.Map"/>. Groups the four
/// cohesive optional/lookup parameters so the method stays within S107 (≤7 params).</summary>
public readonly record struct EventMappingContext(
    string? WorkflowName,
    string? Version,
    string[] ParentDeployments,
    IReadOnlyDictionary<string, string> ServiceMap);
