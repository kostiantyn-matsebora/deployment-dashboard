using System.Text.RegularExpressions;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.GitHub.Mapping;

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
        string? workflowName,
        string? version,
        string[] parentDeployments,
        IReadOnlyDictionary<string, string> serviceMap)
    {
        var runId = ExtractRunId(status.TargetUrl);
        var service = ServiceResolver.Resolve(workflowName, repo, serviceMap);

        return new DeploymentEventIngest
        {
            DeploymentId = $"gh-deploy-{deployment.Id}",
            Service = service,
            Environment = deployment.Environment,
            Version = version,
            Status = contractStatus,
            HappenedAt = status.CreatedAt,
            RunUrl = status.TargetUrl,
            RunNumber = runId?.ToString(),
            Actor = status.Creator?.Login ?? deployment.Creator?.Login,
            Ref = deployment.Ref,
            Sha = deployment.Sha,
            ParentDeployments = parentDeployments.Length > 0 ? parentDeployments : null,
        };
    }

    public static long? ExtractRunId(string? targetUrl)
    {
        if (targetUrl is null) return null;
        var match = RunIdPattern.Match(targetUrl);
        return match.Success && long.TryParse(match.Groups[1].Value, out var id) ? id : null;
    }
}
