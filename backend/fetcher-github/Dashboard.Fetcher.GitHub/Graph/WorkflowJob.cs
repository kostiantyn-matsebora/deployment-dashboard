namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>A job entry from the workflow YAML <c>jobs:</c> map.</summary>
public sealed record WorkflowJob(
    string Id,
    string? Environment,
    IReadOnlyList<string> Needs);
