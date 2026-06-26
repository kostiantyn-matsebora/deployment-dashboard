using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.GitHub.Configuration;

/// <summary>
/// Applies explicit flat SCREAMING_SNAKE env-var overrides to a <see cref="GithubAdapterOptions"/>
/// instance after the appsettings <c>GitHub</c> section has already been bound.
/// </summary>
/// <remarks>
/// Layering: appsettings <c>GitHub</c> section = base; flat <c>GITHUB_*</c> / <c>SERVICE_*</c>
/// env vars = override. Each var overrides only when present AND parseable; absent or unparseable
/// values leave the bound/default value untouched and do not throw. Empty string is skipped for
/// string fields.
/// </remarks>
public static class GithubAdapterOptionsEnv
{
    /// <summary>
    /// Reads the documented flat env vars from <paramref name="config"/>
    /// and applies any valid values to <paramref name="options"/> in place.
    /// </summary>
    public static void ApplyEnvOverrides(IConfiguration config, GithubAdapterOptions options)
    {
        ApplyString(config, "GITHUB_BASE_URL", v => options.BaseUrl = v);
        ApplyString(config, "GITHUB_TOKEN", v => options.Token = v);
        ApplyString(config, "GITHUB_REPOS", v => options.Repos = v);
        ApplyString(config, "GITHUB_VERSION_SOURCE", v => options.VersionSource = v);
        ApplyString(config, "GITHUB_SERVICE_MAP", v => options.ServiceMap = v);
        ApplyInt(config, "GITHUB_RATE_LIMIT", v => options.RateLimit = v);
        ApplyInt(config, "GITHUB_RATE_LIMIT_BUDGET_PCT", v => options.RateLimitBudgetPct = v);
        ApplyString(config, "GITHUB_WORKFLOW_EXCLUDE", v => options.WorkflowExclude = v);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private static void ApplyInt(IConfiguration config, string key, Action<int> apply)
    {
        var raw = config[key];
        if (raw is not null && int.TryParse(raw, out var value))
            apply(value);
    }

    private static void ApplyString(IConfiguration config, string key, Action<string> apply)
    {
        var raw = config[key];
        if (!string.IsNullOrEmpty(raw))
            apply(raw);
    }
}
