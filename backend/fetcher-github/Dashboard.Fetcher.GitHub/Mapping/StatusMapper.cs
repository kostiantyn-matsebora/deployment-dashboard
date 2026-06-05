using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.GitHub.Mapping;

/// <summary>Maps GitHub deployment status state to the contract status string (§5.3).</summary>
public static class StatusMapper
{
    /// <summary>
    /// Maps a raw GitHub deployment_status <c>state</c> to a contract status string,
    /// or null when the state must be skipped
    /// (<c>inactive</c> is a supersession marker, not a lifecycle transition).
    /// </summary>
    public static string? Map(string githubState) => githubState switch
    {
        "pending"     => DeploymentStatus.Pending,
        "queued"      => DeploymentStatus.Queued,
        "in_progress" => DeploymentStatus.InProgress,
        "waiting"     => DeploymentStatus.Waiting,
        "success"     => DeploymentStatus.Success,
        "failure" or "error" => DeploymentStatus.Failure,
        _ => null,  // inactive = supersession marker; unknown states dropped
    };
}
