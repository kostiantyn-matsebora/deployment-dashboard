namespace Dashboard.Fetcher.GitHub;

/// <summary>Shared parsing helpers for GitHub repository slugs.</summary>
internal static class RepoHelper
{
    /// <summary>
    /// Splits a "owner/repo" slug. Returns ("", repo) when no slash is present.
    /// </summary>
    internal static (string Owner, string Repo) SplitRepo(string repo)
    {
        var parts = repo.Split('/', 2);
        return parts.Length == 2 ? (parts[0], parts[1]) : ("", repo);
    }
}
