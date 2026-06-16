using System.Diagnostics;

namespace Dashboard.Read.Analytics;

/// <summary>
/// Parses the <c>ANALYTICS_FUNNEL_ENVIRONMENTS</c> operator configuration into an ordered
/// environment ladder used by <see cref="AnalyticsRepository"/>.
/// The <b>last</b> entry in the ladder is the production terminal that lead-time measures to.
/// </summary>
/// <remarks>
/// All parsed values are normalized to lowercase-invariant so that configured case (e.g. "PrOD")
/// matches the lowercase <c>environment</c> column convention used in the database.
/// </remarks>
internal static class AnalyticsFunnelEnvironments
{
    /// <summary>
    /// Default ladder — dev → staging → qa → preprod → prod.
    /// Applied when the env var is absent, blank, or resolves to zero tokens.
    /// </summary>
    internal static readonly string[] Default =
        ["dev", "staging", "qa", "preprod", "prod"];

    /// <summary>
    /// Parses a comma-separated environment list.
    /// Trims each token; drops empty tokens; normalizes each token to lowercase-invariant.
    /// Returns <see cref="Default"/> when <paramref name="csv"/> is <see langword="null"/>,
    /// empty, or produces no non-empty tokens after splitting.
    /// </summary>
    /// <param name="csv">Raw value of <c>ANALYTICS_FUNNEL_ENVIRONMENTS</c>, or <see langword="null"/>.</param>
    /// <returns>
    /// A non-empty <see cref="string"/> array of lowercase environment names.
    /// Guaranteed to contain at least one element — <c>[^1]</c> access by callers is always safe.
    /// </returns>
    internal static string[] Parse(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv))
            return Default;

        var tokens = csv
            .Split(',')
            .Select(t => t.Trim().ToLowerInvariant())
            .Where(t => t.Length > 0)
            .ToArray();

        // Fallback to default when all tokens were blank/empty after trimming.
        // Postcondition: the returned array is non-empty — [^1] is always safe.
        var result = tokens.Length == 0 ? Default : tokens;
        Debug.Assert(result.Length > 0, "AnalyticsFunnelEnvironments.Parse must never return an empty ladder.");
        return result;
    }
}
