namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>Parsed workflow YAML job graph. Cached per (repo, run_id) (F11).</summary>
public sealed record WorkflowGraph(
    string WorkflowName,
    IReadOnlyDictionary<string, WorkflowJob> AllJobs,
    IReadOnlyDictionary<string, WorkflowJob> DeploymentJobs)
{
    /// <summary>
    /// Returns a <see cref="WorkflowGraph"/> with the given identity and no job graph
    /// (parent_deployments = [] for all events).  Used when the YAML contents fetch fails
    /// or returns non-2xx (e.g. 403 — Contents permission not granted) but identity has
    /// already been resolved via the workflows endpoint (F10 / §5.6.2).
    /// </summary>
    public static WorkflowGraph Empty(string workflowName) =>
        new(workflowName,
            new Dictionary<string, WorkflowJob>(),
            new Dictionary<string, WorkflowJob>());
}
