using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.GitHub.Mapping;

/// <summary>Maps GitHub deployment status state to the contract status string (§5.3).</summary>
public static class StatusMapper
{
    /// <summary>
    /// Returns the contract status string, or null when the state must be skipped
    /// (<c>inactive</c> is a supersession marker, not a lifecycle transition).
    /// </summary>
    public static string? Map(string githubState) => githubState switch
    {
        "queued" or "pending" or "in_progress" => DeploymentStatus.InProgress,
        "success" => DeploymentStatus.Success,
        "failure" or "error" => DeploymentStatus.Failure,
        _ => null
    };
}
