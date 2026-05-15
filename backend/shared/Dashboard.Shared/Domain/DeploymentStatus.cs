namespace Dashboard.Shared.Domain;

/// <summary>
/// Allowed values for the <c>status</c> field of a deployment event.
/// These are the only values accepted by the ingest API and emitted by the
/// matrix/history responses. The wire form is the literal string here.
/// </summary>
public static class DeploymentStatus
{
    public const string InProgress = "in-progress";
    public const string Success = "success";
    public const string Failure = "failure";

    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { InProgress, Success, Failure };

    /// <summary>A status is "terminal" once it represents a finished deployment.</summary>
    public static bool IsTerminal(string status) =>
        status == Success || status == Failure;
}
