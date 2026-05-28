namespace Dashboard.Shared.Contracts;

/// <summary>
/// Allowed values for the <c>status</c> field on a deployment event.
/// Hyphens in the values make a C# enum impractical; string constants are used instead.
/// </summary>
public static class DeploymentStatus
{
    public const string InProgress = "in-progress";
    public const string Success = "success";
    public const string Failure = "failure";

    /// <summary>All valid values for use in validation and switch expressions.</summary>
    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { InProgress, Success, Failure };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}
