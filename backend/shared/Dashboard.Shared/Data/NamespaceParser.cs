using System.Text.RegularExpressions;

namespace Dashboard.Shared.Data;

/// <summary>
/// Parses the <c>namespace</c> value from a CI/CD run URL.
/// For GitHub: extracts the repository short name from
/// <c>https://github.com/{owner}/{repo}/...</c>.
/// Used by the fetcher and mirrors the backfill SQL in the EF migration.
/// </summary>
public static partial class NamespaceParser
{
    [GeneratedRegex(@"^https://github\.com/[^/]+/([^/]+)", RegexOptions.Compiled)]
    private static partial Regex GithubRepoRegex();

    private static readonly Regex GithubRepoPattern = GithubRepoRegex();

    /// <summary>
    /// Returns the namespace derived from <paramref name="runUrl"/>, or <c>null</c>
    /// when the URL is null or does not match a recognised GitHub run URL pattern.
    /// </summary>
    public static string? ParseFromRunUrl(string? runUrl)
    {
        if (runUrl is null) return null;
        var match = GithubRepoPattern.Match(runUrl);
        return match.Success ? match.Groups[1].Value : null;
    }
}
