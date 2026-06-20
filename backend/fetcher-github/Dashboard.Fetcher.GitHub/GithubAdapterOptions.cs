using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Fetcher.GitHub;

/// <summary>Config bound from the appsettings <c>GitHub</c> section; overridden by flat <c>GITHUB_*</c> env vars (§6).</summary>
public sealed class GithubAdapterOptions
{
    public string BaseUrl { get; set; } = "https://api.github.com";
    public string Token { get; set; } = "";

    /// <summary>
    /// Comma-separated repo specifiers. Supports exact <c>owner/repo</c>, owner-wildcard
    /// <c>owner/*</c>, and bare <c>*</c> (all accessible repos). Empty = no repos / no polling.
    /// Globs are expanded at startup via the GitHub API (list repos).
    /// </summary>
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

    // ── service exclude filter ────────────────────────────────────────────────

    /// <summary>
    /// CSV of <c>owner/repo/service</c> glob patterns. Matching services are never ingested.
    /// Empty = exclude nothing. Bound from <c>SERVICE_EXCLUDE</c> env var.
    /// </summary>
    public string ServiceExclude { get; set; } = "";

    /// <summary>Builds the <see cref="ServiceFilter"/> from the <c>ServiceExclude</c> CSV.</summary>
    public ServiceFilter BuildServiceFilter() => ServiceFilter.Parse(ServiceExclude);

    // ── derived helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Returns the raw repo specifiers (possibly containing globs). Exact <c>owner/repo</c>
    /// entries need no discovery; entries containing <c>*</c> are expanded at startup.
    /// An empty string yields an empty list — meaning no repos and no polling.
    /// </summary>
    public IReadOnlyList<string> RepoSpecs =>
        string.IsNullOrWhiteSpace(Repos)
            ? []
            : Repos.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                   .ToList();

    /// <summary>
    /// Returns only the exact <c>owner/repo</c> specifiers (no glob characters).
    /// These are used directly without GitHub API discovery.
    /// </summary>
    public IReadOnlyList<string> RepoList =>
        RepoSpecs.Where(s => !s.Contains('*')).ToList();

    public IReadOnlyDictionary<string, string> ServiceMapDict =>
        ServiceMap
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(p => p.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0].Trim(), parts => parts[1].Trim());
}
