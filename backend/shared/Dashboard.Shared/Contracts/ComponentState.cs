namespace Dashboard.Shared.Contracts;

/// <summary>
/// Allowed values for the <c>state</c> field on a component event.
/// String constants (not a C# enum) for wire-shape parity with the OpenAPI <c>ComponentState</c> enum.
/// </summary>
public static class ComponentState
{
    public const string Running = "running";
    public const string Idle = "idle";
    public const string Paused = "paused";
    public const string Error = "error";

    /// <summary>All valid values for use in validation and switch expressions.</summary>
    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { Running, Idle, Paused, Error };

    public static bool IsValid(string? value) => value is not null && All.Contains(value);
}
