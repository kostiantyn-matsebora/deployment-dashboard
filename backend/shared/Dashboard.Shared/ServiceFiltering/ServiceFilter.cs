namespace Dashboard.Shared.ServiceFiltering;

/// <summary>
/// Deployment-wide service include/exclude filter.
/// Parses four CSV env-var pattern lists (<c>SERVICE_INCLUDE</c>, <c>SERVICE_EXCLUDE</c>,
/// <c>REPO_INCLUDE</c>, <c>REPO_EXCLUDE</c>) and exposes a single <c>Permits</c> method
/// used identically by the fetcher (poll-time) and the read API (read-time).
/// </summary>
/// <remarks>
/// <para><b>SERVICE glob rules</b> (mirrors the existing matrix/services-filter semantics):</para>
/// <list type="bullet">
///   <item>Pattern containing <c>'/'</c> → matched against the full <c>namespace/service</c> composite.</item>
///   <item>Pattern without <c>'/'</c> → matched against the <c>service</c> segment only, across all namespaces.</item>
///   <item><c>'*'</c> is the only supported wildcard — matches any sequence of characters (including empty).</item>
/// </list>
/// <para><b>REPO glob rules</b>:</para>
/// <list type="bullet">
///   <item>Fetcher overload (<see cref="Permits(string,string,string)"/>) — pattern matched against the full <c>owner/repo</c> string.</item>
///   <item>Read-API overload (<see cref="Permits(string,string)"/>) — pattern's <em>name segment</em> (right of '/') matched against <c>namespace</c> (which equals the repo short name).</item>
/// </list>
/// <para><b>Precedence</b>: exclude wins over include.</para>
/// <para><b>Empty defaults</b>: empty include list ⇒ match all; empty exclude list ⇒ exclude none.</para>
/// <para><b>Effective rule</b>: passes iff
///   (SERVICE_INCLUDE+REPO_INCLUDE both empty OR service matches SERVICE_INCLUDE OR repo matches REPO_INCLUDE)
///   AND NOT (service matches SERVICE_EXCLUDE OR repo matches REPO_EXCLUDE).
/// </para>
/// </remarks>
public sealed class ServiceFilter
{
    private readonly IReadOnlyList<string> _serviceInclude;
    private readonly IReadOnlyList<string> _serviceExclude;
    private readonly IReadOnlyList<string> _repoInclude;
    private readonly IReadOnlyList<string> _repoExclude;

    /// <summary>A pass-all filter: no patterns on any list.</summary>
    public static readonly ServiceFilter PassAll = new([], [], [], []);

    /// <summary>
    /// Returns <c>true</c> when this filter carries no include or exclude patterns,
    /// meaning every event is permitted and no in-memory post-filtering is needed.
    /// </summary>
    public bool IsPassAll =>
        _serviceInclude.Count == 0 &&
        _serviceExclude.Count == 0 &&
        _repoInclude.Count == 0 &&
        _repoExclude.Count == 0;

    public ServiceFilter(
        IReadOnlyList<string> serviceInclude,
        IReadOnlyList<string> serviceExclude,
        IReadOnlyList<string> repoInclude,
        IReadOnlyList<string> repoExclude)
    {
        _serviceInclude = serviceInclude;
        _serviceExclude = serviceExclude;
        _repoInclude = repoInclude;
        _repoExclude = repoExclude;
    }

    /// <summary>
    /// Parses the four CSV pattern strings into a <see cref="ServiceFilter"/>.
    /// Each value may be <c>null</c> or empty (treated as an empty list).
    /// </summary>
    public static ServiceFilter Parse(
        string? serviceIncludeCsv,
        string? serviceExcludeCsv,
        string? repoIncludeCsv,
        string? repoExcludeCsv)
    {
        return new ServiceFilter(
            ParseCsv(serviceIncludeCsv),
            ParseCsv(serviceExcludeCsv),
            ParseCsv(repoIncludeCsv),
            ParseCsv(repoExcludeCsv));
    }

    /// <summary>
    /// Read-API overload: tests whether a stored event should be visible.
    /// </summary>
    /// <param name="service">The event's service field.</param>
    /// <param name="namespace">
    /// The event's namespace field (= repo short name, e.g. "my-api").
    /// REPO patterns are matched via the pattern's name segment (right of '/').
    /// </param>
    /// <returns><c>true</c> when the event passes the filter.</returns>
    public bool Permits(string service, string? @namespace)
    {
        var includeEmpty = _serviceInclude.Count == 0 && _repoInclude.Count == 0;

        var includedByService = _serviceInclude.Count > 0 && MatchesServicePatterns(service, @namespace, _serviceInclude);
        var includedByRepo = _repoInclude.Count > 0 && MatchesRepoNameSegmentPatterns(@namespace, _repoInclude);

        var passesInclude = includeEmpty || includedByService || includedByRepo;
        if (!passesInclude)
            return false;

        var excludedByService = _serviceExclude.Count > 0 && MatchesServicePatterns(service, @namespace, _serviceExclude);
        var excludedByRepo = _repoExclude.Count > 0 && MatchesRepoNameSegmentPatterns(@namespace, _repoExclude);

        return !(excludedByService || excludedByRepo);
    }

    /// <summary>
    /// Fetcher overload: tests whether a polled event should be ingested.
    /// </summary>
    /// <param name="service">The resolved service name.</param>
    /// <param name="namespace">The repo short name (= namespace).</param>
    /// <param name="ownerRepo">The full owner/repo string the fetcher polls (e.g. "acme/my-api").</param>
    /// <returns><c>true</c> when the event passes the filter.</returns>
    public bool Permits(string service, string? @namespace, string ownerRepo)
    {
        var includeEmpty = _serviceInclude.Count == 0 && _repoInclude.Count == 0;

        var includedByService = _serviceInclude.Count > 0 && MatchesServicePatterns(service, @namespace, _serviceInclude);
        var includedByRepo = _repoInclude.Count > 0 && MatchesRepoFullPatterns(ownerRepo, _repoInclude);

        var passesInclude = includeEmpty || includedByService || includedByRepo;
        if (!passesInclude)
            return false;

        var excludedByService = _serviceExclude.Count > 0 && MatchesServicePatterns(service, @namespace, _serviceExclude);
        var excludedByRepo = _repoExclude.Count > 0 && MatchesRepoFullPatterns(ownerRepo, _repoExclude);

        return !(excludedByService || excludedByRepo);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private static bool MatchesServicePatterns(string service, string? @namespace, IReadOnlyList<string> patterns)
    {
        foreach (var pattern in patterns)
        {
            if (pattern.Contains('/'))
            {
                // Composite match: pattern has slash — match against namespace/service.
                var composite = @namespace is not null ? $"{@namespace}/{service}" : service;
                if (GlobMatch(pattern, composite))
                    return true;
            }
            else
            {
                // Segment match: match against service name only, across all namespaces.
                if (GlobMatch(pattern, service))
                    return true;
            }
        }

        return false;
    }

    private static bool MatchesRepoFullPatterns(string ownerRepo, IReadOnlyList<string> patterns)
    {
        foreach (var pattern in patterns)
        {
            if (GlobMatch(pattern, ownerRepo))
                return true;
        }

        return false;
    }

    private static bool MatchesRepoNameSegmentPatterns(string? @namespace, IReadOnlyList<string> patterns)
    {
        if (@namespace is null)
            return false;

        foreach (var pattern in patterns)
        {
            // Use the name segment (right of '/') of the pattern for namespace matching.
            var nameSegment = ExtractNameSegment(pattern);
            if (GlobMatch(nameSegment, @namespace))
                return true;
        }

        return false;
    }

    private static string ExtractNameSegment(string pattern)
    {
        var slashIndex = pattern.IndexOf('/');
        return slashIndex >= 0 ? pattern[(slashIndex + 1)..] : pattern;
    }

    /// <summary>
    /// Matches <paramref name="value"/> against a glob <paramref name="pattern"/> where
    /// <c>'*'</c> is the only wildcard (matches any sequence of characters including empty).
    /// Case-sensitive. DP-based O(m*n) implementation — no regex, no third-party deps.
    /// </summary>
    public static bool GlobMatch(string pattern, string value)
    {
        var pLen = pattern.Length;
        var vLen = value.Length;

        // dp[i][j] = true iff pattern[0..i-1] matches value[0..j-1]
        var dp = new bool[pLen + 1, vLen + 1];
        dp[0, 0] = true;

        // A run of leading '*' wildcards can match the empty string.
        for (var i = 1; i <= pLen; i++)
        {
            if (pattern[i - 1] == '*')
                dp[i, 0] = dp[i - 1, 0];
        }

        for (var i = 1; i <= pLen; i++)
        {
            for (var j = 1; j <= vLen; j++)
            {
                if (pattern[i - 1] == '*')
                {
                    // '*' matches zero chars (dp[i-1,j]) or one more char (dp[i,j-1]).
                    dp[i, j] = dp[i - 1, j] || dp[i, j - 1];
                }
                else
                {
                    dp[i, j] = dp[i - 1, j - 1] && pattern[i - 1] == value[j - 1];
                }
            }
        }

        return dp[pLen, vLen];
    }

    private static IReadOnlyList<string> ParseCsv(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv))
            return [];

        return csv
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => p.Length > 0)
            .ToList();
    }
}
