using System.Text.RegularExpressions;

namespace Dashboard.Shared.Data;

/// <summary>
/// Parses the <c>namespace</c> value from a GitHub Actions run URL.
/// Derives the repository short name from the path segment immediately before
/// <c>/actions/</c>, regardless of host (github.com, api.github.com,
/// enterprise hosts, or local emulators).
/// Used by the fetcher and mirrors the backfill SQL in the EF migration.
/// </summary>
public static partial class NamespaceParser
{
    [GeneratedRegex(@"/([^/]+)/actions/", RegexOptions.Compiled)]
    private static partial Regex GithubRepoRegex();

    private static readonly Regex GithubRepoPattern = GithubRepoRegex();

    /// <summary>
    /// Returns the repository short name derived from <paramref name="runUrl"/>, or <c>null</c>
    /// when the URL is null or does not contain a <c>/actions/</c> path segment.
    /// </summary>
    public static string? ParseFromRunUrl(string? runUrl)
    {
        if (runUrl is null) return null;
        var match = GithubRepoPattern.Match(runUrl);
        return match.Success ? match.Groups[1].Value : null;
    }
}
