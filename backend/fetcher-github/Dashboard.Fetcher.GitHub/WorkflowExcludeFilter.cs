using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Fetcher.GitHub;

/// <summary>
/// GitHub-specific workflow exclude filter (<c>GITHUB_WORKFLOW_EXCLUDE</c>, issue #348).
/// Matched against the triple <c>(owner, repo, workflow)</c> — three clean segments that
/// never contain <c>'/'</c> in GitHub's own naming.  Each segment is glob-matched
/// independently with <see cref="Glob.Matches"/>.
/// </summary>
/// <remarks>
/// This is deliberately provider-specific and lives inside <c>Dashboard.Fetcher.GitHub</c>.
/// A future Azure DevOps or Jenkins adapter would add its own exclude filter in its own
/// project — the generic <c>Dashboard.Fetcher</c> abstraction knows nothing about this.
/// </remarks>
public sealed class WorkflowExcludeFilter
{
    // Each pattern is stored as pre-split [owner, repo, workflow] segments.
    private readonly IReadOnlyList<string[]> _patterns;

    /// <summary>A pass-all filter: no exclude patterns.</summary>
    public static readonly WorkflowExcludeFilter PassAll = new([]);

    /// <summary>
    /// Returns <c>true</c> when this filter carries no patterns — every workflow passes and
    /// no in-memory matching is needed.
    /// </summary>
    public bool IsEmpty => _patterns.Count == 0;

    private WorkflowExcludeFilter(IReadOnlyList<string[]> patterns)
    {
        _patterns = patterns;
    }

    /// <summary>
    /// Parses a CSV of <c>owner/repo/workflow</c> glob patterns.
    /// Patterns with fewer than three slash-separated segments get <c>"*"</c> prepended
    /// for each missing leading segment.
    /// <c>null</c> or empty ⇒ <see cref="PassAll"/>.
    /// </summary>
    public static WorkflowExcludeFilter Parse(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv))
            return PassAll;

        var patterns = csv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(SplitPattern)
            .ToList();

        return patterns.Count == 0 ? PassAll : new WorkflowExcludeFilter(patterns);
    }

    /// <summary>
    /// Returns <c>true</c> when the given <c>(owner, repo, workflow)</c> triple matches any
    /// configured exclude pattern.  All three segments are glob-matched independently.
    /// </summary>
    public bool IsExcluded(string owner, string repo, string workflow)
    {
        if (IsEmpty) return false;

        foreach (var segments in _patterns)
        {
            if (Glob.Matches(segments[0], owner) &&
                Glob.Matches(segments[1], repo) &&
                Glob.Matches(segments[2], workflow))
                return true;
        }

        return false;
    }

    // ── private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Splits a pattern into exactly three segments <c>[owner, repo, workflow]</c>.
    /// Patterns with fewer slashes get <c>"*"</c> prepended for missing leading segments.
    /// </summary>
    private static string[] SplitPattern(string pattern)
    {
        var parts = pattern.Split('/', 3);
        return parts.Length switch
        {
            3 => parts,
            2 => ["*", parts[0], parts[1]],
            _ => ["*", "*", parts[0]],
        };
    }
}
