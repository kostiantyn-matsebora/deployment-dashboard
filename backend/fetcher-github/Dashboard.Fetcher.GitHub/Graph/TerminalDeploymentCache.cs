namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>
/// Bounded cache of deployments observed in a terminal state during the live poll.
/// Maps deploymentId to the run_id extracted from that deployment's last status
/// (null when no target_url was present).
///
/// Terminal GitHub states: success, failure, error, inactive.
/// Non-terminal: queued, pending, in_progress, waiting, or no statuses yet.
///
/// The cache is used by PollRepoAsync to skip re-fetching /statuses for deployments
/// that will never change, while still retaining them in the parent-derivation map.
///
/// Capacity: 2 000 entries, FIFO/LRU eviction via BoundedLruCache.
/// </summary>
internal sealed class TerminalDeploymentCache
{
    private const int Capacity = 2000;

    private readonly BoundedLruCache<long, long?> _cache = new(Capacity);

    /// <summary>
    /// Returns true and populates <paramref name="cachedRunId"/> when the deployment
    /// is already known to be terminal.
    /// </summary>
    public bool TryGet(long deploymentId, out long? cachedRunId) =>
        _cache.TryGet(deploymentId, out cachedRunId);

    /// <summary>Records a deployment as terminal with its extracted run_id (may be null).</summary>
    public void Record(long deploymentId, long? runId) =>
        _cache.Set(deploymentId, runId);

    /// <summary>
    /// Returns true when the given raw GitHub state is terminal.
    /// Uses the raw GitHub state — NOT the contract mapping.
    /// </summary>
    public static bool IsTerminalState(string githubState) =>
        githubState is "success" or "failure" or "error" or "inactive";
}
