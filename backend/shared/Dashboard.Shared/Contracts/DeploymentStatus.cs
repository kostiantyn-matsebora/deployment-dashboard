namespace Dashboard.Shared.Contracts;

/// <summary>
/// Allowed values for the <c>status</c> field on a deployment event.
/// Hyphens in the values make a C# enum impractical; string constants are used instead.
/// </summary>
public static class DeploymentStatus
{
    public const string Pending = "pending";
    public const string Queued = "queued";
    public const string InProgress = "in-progress";
    public const string Waiting = "waiting";
    public const string Success = "success";
    public const string Failure = "failure";
    public const string Cancelled = "cancelled";
    public const string Rejected = "rejected";

    /// <summary>All valid values for use in validation and switch expressions.</summary>
    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal)
        {
            Pending, Queued, InProgress, Waiting, Success, Failure, Cancelled, Rejected,
        };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);

    /// <summary>
    /// Terminal statuses — polling skips re-fetching; no further transitions expected.
    /// </summary>
    public static bool IsTerminal(string status) =>
        status is Success or Failure or Cancelled or Rejected;
}
