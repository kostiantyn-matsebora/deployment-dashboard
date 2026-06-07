namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>
/// BFS algorithm to find parent deployment jobs for a given deployment job (§5.6.3).
/// Non-deployment intermediary jobs are transparent — the search continues through them.
/// </summary>
public static class ParentDerivation
{
    /// <summary>
    /// Returns the job IDs of direct deployment ancestors of <paramref name="job"/>.
    /// Does NOT recurse through found deployment ancestors (preserves per-environment direct edges).
    /// </summary>
    public static IReadOnlyList<string> FindParentDeploymentJobIds(
        WorkflowJob job,
        IReadOnlyDictionary<string, WorkflowJob> deploymentJobs,
        IReadOnlyDictionary<string, WorkflowJob> allJobs)
    {
        var queue = new Queue<string>(job.Needs);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var parents = new List<string>();

        while (queue.Count > 0)
        {
            var id = queue.Dequeue();
            if (!visited.Add(id))
                continue;

            if (deploymentJobs.ContainsKey(id) && id != job.Id)
            {
                parents.Add(id);
                // Do not recurse further through this deployment ancestor (§5.6.3)
            }
            else if (allJobs.TryGetValue(id, out var intermediary))
            {
                foreach (var need in intermediary.Needs)
                    queue.Enqueue(need);
            }
        }

        return parents;
    }

    /// <summary>
    /// Builds the envToDeploymentId map for a poll cycle (§5.6.4).
    /// Result: run_id → (environment → "gh-deploy-{id}").
    /// Collision (same run_id + environment): keeps deployment with latest created_at.
    /// </summary>
    public static Dictionary<long, Dictionary<string, string>> BuildEnvToDeploymentIdMap(
        IEnumerable<(long DeploymentId, string Environment, DateTimeOffset CreatedAt, long? RunId)> entries)
    {
        var temp = new Dictionary<long, Dictionary<string, (long DeploymentId, DateTimeOffset CreatedAt)>>();

        foreach (var (deploymentId, environment, createdAt, runId) in entries)
        {
            if (runId is null)
                continue;

            if (!temp.TryGetValue(runId.Value, out var envMap))
            {
                envMap = new Dictionary<string, (long, DateTimeOffset)>(StringComparer.OrdinalIgnoreCase);
                temp[runId.Value] = envMap;
            }

            if (!envMap.TryGetValue(environment, out var existing) || createdAt > existing.CreatedAt)
                envMap[environment] = (deploymentId, createdAt);
        }

        return temp.ToDictionary(
            outer => outer.Key,
            outer => outer.Value.ToDictionary(
                inner => inner.Key,
                inner => $"gh-deploy-{inner.Value.DeploymentId}"));
    }
}
