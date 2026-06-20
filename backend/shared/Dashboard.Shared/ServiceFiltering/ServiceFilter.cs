namespace Dashboard.Shared.ServiceFiltering;

/// <summary>
/// Deployment-wide service exclude filter (issue #348).
/// Parses one CSV env-var pattern list (<c>SERVICE_EXCLUDE</c>) of <c>owner/repo/service</c>
/// glob patterns and exposes two <c>IsExcluded</c> matchers:
/// <list type="bullet">
///   <item>Fetcher — full <c>(owner, repo, service)</c> triple: all three segments matched.</item>
///   <item>API — <c>(namespace, service)</c> pair: matched against the pattern's last two
///     <c>repo/service</c> segments; the leading <c>owner</c> segment is wildcarded because
///     the API does not store owner.</item>
/// </list>
/// </summary>
/// <remarks>
/// <para><b>Pattern form:</b> <c>owner/repo/service</c>.
///   Each segment may contain <c>'*'</c> as a wildcard matching any sequence of characters
///   (including empty). Examples: <c>acme/web/legacy-*</c>, <c>acme/*/internal</c>,
///   <c>*/*/canary</c>.</para>
/// <para><b>Empty default:</b> empty <c>SERVICE_EXCLUDE</c> ⇒ exclude nothing.</para>
/// <para><b>Fast path:</b> when <see cref="IsEmpty"/> is true, both matchers return
///   <c>false</c> without any pattern evaluation (pass-all).</para>
/// </remarks>
public sealed class ServiceFilter
{
    // Each pattern is stored as three pre-split segments: [owner, repo, service].
    private readonly IReadOnlyList<string[]> _patterns;

    /// <summary>A pass-all filter: no exclude patterns.</summary>
    public static readonly ServiceFilter PassAll = new([]);

    /// <summary>
    /// Returns <c>true</c> when this filter carries no patterns — every event passes and
    /// no in-memory matching is needed.
    /// </summary>
    public bool IsEmpty => _patterns.Count == 0;

    private ServiceFilter(IReadOnlyList<string[]> patterns)
    {
        _patterns = patterns;
    }

    /// <summary>
    /// Parses a CSV of <c>owner/repo/service</c> glob patterns.
    /// <c>null</c> or empty ⇒ <see cref="PassAll"/>.
    /// </summary>
    public static ServiceFilter Parse(string? serviceExcludeCsv)
    {
        if (string.IsNullOrWhiteSpace(serviceExcludeCsv))
            return PassAll;

        var patterns = serviceExcludeCsv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(SplitPattern)
            .ToList();

        return patterns.Count == 0 ? PassAll : new ServiceFilter(patterns);
    }

    // ── Fetcher overload ─────────────────────────────────────────────────────

    /// <summary>
    /// Fetcher overload: returns <c>true</c> when the full <c>(owner, repo, service)</c>
    /// triple matches any configured exclude pattern (all three segments).
    /// Used at poll time — the fetcher knows the owner from the repo it polls.
    /// </summary>
    public bool IsExcluded(string owner, string repo, string service)
    {
        if (IsEmpty) return false;

        foreach (var segments in _patterns)
        {
            if (GlobMatch(segments[0], owner) &&
                GlobMatch(segments[1], repo) &&
                GlobMatch(segments[2], service))
                return true;
        }

        return false;
    }

    // ── API overload (read + write) ───────────────────────────────────────────

    /// <summary>
    /// API overload: returns <c>true</c> when <c>(namespace, service)</c> matches any
    /// configured exclude pattern's last two <c>repo/service</c> segments.
    /// The leading <c>owner</c> segment is wildcarded — the API does not store owner.
    /// <paramref name="namespace"/> may be <c>null</c>; a null namespace is matched against
    /// the pattern's repo segment as-is (GlobMatch("*", null-as-empty) is always true
    /// when pattern is "*"; a literal pattern never matches empty).
    /// </summary>
    public bool IsExcluded(string service, string? @namespace)
    {
        if (IsEmpty) return false;

        foreach (var segments in _patterns)
        {
            // segments[0] = owner → wildcarded (ignore)
            // segments[1] = repo  → matched against namespace
            // segments[2] = svc   → matched against service
            var nsValue = @namespace ?? string.Empty;
            if (GlobMatch(segments[1], nsValue) &&
                GlobMatch(segments[2], service))
                return true;
        }

        return false;
    }

    // ── Permits helpers (for callers using the old positive-sense API) ────────

    /// <summary>
    /// Read-API convenience wrapper: returns <c>true</c> when the event should be visible
    /// (i.e., NOT excluded). Mirrors the old <c>Permits(service, namespace)</c> API.
    /// </summary>
    public bool Permits(string service, string? @namespace) => !IsExcluded(service, @namespace);

    /// <summary>
    /// Fetcher convenience wrapper: returns <c>true</c> when the event should be ingested
    /// (i.e., NOT excluded). Mirrors the old <c>Permits(service, namespace, ownerRepo)</c> API.
    /// </summary>
    public bool Permits(string service, string? @namespace, string ownerRepo)
    {
        // ownerRepo is in "owner/repo" form; split for the three-segment match.
        var parts = ownerRepo.Split('/', 2);
        var owner = parts.Length == 2 ? parts[0] : string.Empty;
        var repo = parts.Length == 2 ? parts[1] : ownerRepo;
        return !IsExcluded(owner, repo, service);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Splits a pattern into exactly three segments <c>[owner, repo, service]</c>.
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

    /// <summary>
    /// Matches <paramref name="value"/> against a glob <paramref name="pattern"/> where
    /// <c>'*'</c> matches any sequence of characters (including empty) and <c>'?'</c> a single
    /// character. Case-sensitive. Delegates to the BCL
    /// <see cref="System.IO.Enumeration.FileSystemName.MatchesSimpleExpression(System.ReadOnlySpan{char}, System.ReadOnlySpan{char}, bool)"/>;
    /// the empty-<paramref name="value"/> case is handled explicitly because that matcher does
    /// not treat an all-<c>'*'</c> pattern as matching the empty string (a service-only pattern
    /// must still exclude a null-namespace event).
    /// </summary>
    public static bool GlobMatch(string pattern, string value)
        => value.Length == 0
            ? pattern.AsSpan().IndexOfAnyExcept('*') < 0
            : System.IO.Enumeration.FileSystemName.MatchesSimpleExpression(pattern, value, ignoreCase: false);
}
