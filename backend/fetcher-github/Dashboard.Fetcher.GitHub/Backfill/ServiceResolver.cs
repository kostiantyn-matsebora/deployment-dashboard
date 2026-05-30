namespace Dashboard.Fetcher.GitHub.Backfill;

/// <summary>
/// Resolves the service name for a deployment event (§5.8.3, F12).
/// Resolution order: workflow-level SERVICE_MAP → repo-level SERVICE_MAP → workflow name → repo short name.
/// </summary>
public static class ServiceResolver
{
    /// <summary>
    /// <paramref name="workflowName"/> is the workflow YAML <c>name:</c> field (null for non-Actions deployments).
    /// <paramref name="repo"/> is "owner/repo".
    /// </summary>
    public static string Resolve(
        string? workflowName,
        string repo,
        IReadOnlyDictionary<string, string> serviceMap)
    {
        if (workflowName is not null && serviceMap.TryGetValue(workflowName, out var wfOverride))
            return wfOverride;

        if (serviceMap.TryGetValue(repo, out var repoOverride))
            return repoOverride;

        if (workflowName is not null)
            return workflowName;

        return repo.Split('/').Last();
    }
}
