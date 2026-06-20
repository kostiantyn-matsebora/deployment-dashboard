using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// Expands a list of repo specifiers (which may include glob patterns) into a concrete,
/// deduplicated list of <c>owner/repo</c> strings by querying the GitHub REST API.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item>Exact <c>owner/repo</c> specs pass through unchanged — no API call.</item>
///   <item><c>owner/*</c> specs list that owner's repos and filter by the glob.</item>
///   <item>Bare <c>*</c> lists all repos accessible to the token and includes all of them.</item>
///   <item>When no spec contains a wildcard, the lister delegate is never called.</item>
/// </list>
/// </remarks>
public static class RepoSpecExpander
{
    /// <summary>
    /// Expands <paramref name="specs"/> into a concrete, deduplicated <c>owner/repo</c> list.
    /// </summary>
    /// <param name="specs">Raw repo specifiers, possibly containing <c>'*'</c> globs.</param>
    /// <param name="listReposAsync">
    ///   Delegate that lists repos for an optional owner (<c>null</c> = all accessible repos).
    ///   Only called when at least one spec contains a glob.
    /// </param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>
    ///   Deduplicated list of exact <c>owner/repo</c> strings; empty when
    ///   <paramref name="specs"/> is empty.
    /// </returns>
    public static async Task<IReadOnlyList<string>> ExpandAsync(
        IReadOnlyList<string> specs,
        Func<string?, CancellationToken, Task<IReadOnlyList<string>>> listReposAsync,
        CancellationToken ct)
    {
        if (specs.Count == 0)
            return [];

        if (!specs.Any(s => s.Contains('*')))
        {
            // No globs — all specs are exact; return as-is (deduped).
            return specs.Distinct().ToList();
        }

        var resolved = new List<string>();

        foreach (var spec in specs)
        {
            if (!spec.Contains('*'))
            {
                // Exact owner/repo — no discovery needed.
                resolved.Add(spec);
                continue;
            }

            // Determine which owner's repos to list, then filter by glob.
            string? owner = null;
            if (spec != "*")
            {
                // Form: owner/* — list that owner's repos.
                var slash = spec.IndexOf('/');
                if (slash > 0)
                    owner = spec[..slash];
            }

            var discovered = await listReposAsync(owner, ct);
            foreach (var repo in discovered)
            {
                if (ServiceFilter.GlobMatch(spec, repo))
                    resolved.Add(repo);
            }
        }

        return resolved.Distinct().ToList();
    }
}
