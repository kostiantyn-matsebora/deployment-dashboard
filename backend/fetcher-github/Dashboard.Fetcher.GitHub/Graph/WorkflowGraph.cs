namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>Parsed workflow YAML job graph. Cached per (repo, run_id) (F11).</summary>
public sealed record WorkflowGraph(
    string WorkflowName,
    IReadOnlyDictionary<string, WorkflowJob> AllJobs,
    IReadOnlyDictionary<string, WorkflowJob> DeploymentJobs);
