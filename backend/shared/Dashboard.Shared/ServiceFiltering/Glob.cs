namespace Dashboard.Shared.ServiceFiltering;

/// <summary>
/// Shared glob-matching helper used by <see cref="ServiceFilter"/> and any adapter-specific
/// exclude filters (e.g. <c>WorkflowExcludeFilter</c> in Dashboard.Fetcher.GitHub).
/// </summary>
public static class Glob
{
    /// <summary>
    /// Returns <c>true</c> when <paramref name="value"/> matches the glob
    /// <paramref name="pattern"/>, where <c>'*'</c> matches any sequence of characters
    /// (including empty, including '/') and <c>'?'</c> matches exactly one character.
    /// Case-sensitive. Delegates to
    /// <see cref="System.IO.Enumeration.FileSystemName.MatchesSimpleExpression"/>; the
    /// empty-<paramref name="value"/> case is handled explicitly because that matcher does
    /// not treat an all-<c>'*'</c> pattern as matching the empty string.
    /// </summary>
    public static bool Matches(string pattern, string value)
        => value.Length == 0
            ? pattern.AsSpan().IndexOfAnyExcept('*') < 0
            : System.IO.Enumeration.FileSystemName.MatchesSimpleExpression(pattern, value, ignoreCase: false);
}
