using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Fetcher.GitHub;

/// <summary>Config bound from the appsettings <c>GitHub</c> section; overridden by flat <c>GITHUB_*</c> env vars (§6).</summary>
public sealed class GithubAdapterOptions
{
    public string BaseUrl { get; set; } = "https://api.github.com";
    public string Token { get; set; } = "";

    /// <summary>Comma-separated "owner/repo" values.</summary>
    public string Repos { get; set; } = "";

    /// <summary>
    /// Optional overrides: comma-separated "key=value" pairs.
    /// Key without "/" = workflow-level; key with "/" = repo-level (§5.8.3).
    /// </summary>
    public string ServiceMap { get; set; } = "";

    /// <summary>Version source: "attribute:sha" | "payload:field" | "artifact:name" (§5.7).</summary>
    public string VersionSource { get; set; } = "attribute:sha";

    /// <summary>Total hourly request quota. 0 = discover via GET /rate_limit (F16).</summary>
    public int RateLimit { get; set; } = 0;

    /// <summary>Percentage of quota the fetcher may consume per hour (1–100). Default 30 (F16).</summary>
    public int RateLimitBudgetPct { get; set; } = 30;

    /// <summary>
    /// How far back backfill scans per environment.
    /// Defaults to the host's INITIAL_LOOKBACK when zero (§6, F13).
    /// </summary>
    public TimeSpan BackfillMaxAge { get; set; } = TimeSpan.Zero;

    // ── service filter ────────────────────────────────────────────────────────

    /// <summary>CSV glob patterns: only these services are ingested. Empty = all.</summary>
    public string ServiceInclude { get; set; } = "";

    /// <summary>CSV glob patterns: these services are always skipped. Empty = none.</summary>
    public string ServiceExclude { get; set; } = "";

    /// <summary>CSV glob patterns (owner/repo): only these repos are ingested. Empty = all.</summary>
    public string RepoInclude { get; set; } = "";

    /// <summary>CSV glob patterns (owner/repo): these repos are always skipped. Empty = none.</summary>
    public string RepoExclude { get; set; } = "";

    /// <summary>Builds the <see cref="ServiceFilter"/> from the four CSV pattern properties.</summary>
    public ServiceFilter BuildServiceFilter() =>
        ServiceFilter.Parse(ServiceInclude, ServiceExclude, RepoInclude, RepoExclude);

    // ── derived helpers ───────────────────────────────────────────────────────

    public IReadOnlyList<string> RepoList =>
        Repos.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    public IReadOnlyDictionary<string, string> ServiceMapDict =>
        ServiceMap
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(p => p.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0].Trim(), parts => parts[1].Trim());
}
