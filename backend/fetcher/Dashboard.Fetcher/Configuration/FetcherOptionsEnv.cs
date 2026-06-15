using System.Globalization;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Configuration;

/// <summary>
/// Applies explicit env-var overrides to a <see cref="FetcherOptions"/> instance (§6).
/// </summary>
/// <remarks>
/// Top-level vars (<c>POLL_INTERVAL_SECONDS</c>, <c>INITIAL_LOOKBACK</c>, etc.) are
/// SCREAMING_SNAKE names that do NOT bind through .NET's PascalCase-matching rule.
/// They must be read explicitly — the same pattern used for <c>CONTROL_API_KEY</c> /
/// <c>COMPONENT_ID</c> before this helper was introduced.
/// Each var overrides only when present AND parseable; absent or unparseable values
/// leave the bound/default value untouched and do not throw.
/// </remarks>
public static class FetcherOptionsEnv
{
    /// <summary>
    /// Reads the documented SCREAMING_SNAKE env vars from <paramref name="config"/>
    /// and applies any valid values to <paramref name="options"/> in place.
    /// </summary>
    public static void ApplyEnvOverrides(IConfiguration config, FetcherOptions options)
    {
        ApplyInt(config, "POLL_INTERVAL_SECONDS", v => options.PollIntervalSeconds = v);
        ApplyTimeSpan(config, "INITIAL_LOOKBACK", v => options.InitialLookback = v);
        ApplyBool(config, "BACKFILL", v => options.Backfill = v);
        ApplyTimeSpan(config, "BACKFILL_MAX_AGE", v => options.BackfillMaxAge = v);
        ApplyInt(config, "BACKFILL_DEPTH", v => options.BackfillDepth = v);
        ApplyString(config, "CONTROL_API_KEY", v => options.ControlApiKey = v);
        ApplyString(config, "COMPONENT_ID", v => options.ComponentId = v);
        ApplyDateTimeOffset(config, "FETCHER_NOW", v => options.NowOverride = v);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    private static void ApplyInt(IConfiguration config, string key, Action<int> apply)
    {
        var raw = config[key];
        if (raw is not null && int.TryParse(raw, out var value))
            apply(value);
    }

    private static void ApplyTimeSpan(IConfiguration config, string key, Action<TimeSpan> apply)
    {
        var raw = config[key];
        if (raw is not null && TimeSpan.TryParse(raw, out var value))
            apply(value);
    }

    private static void ApplyDateTimeOffset(IConfiguration config, string key, Action<DateTimeOffset> apply)
    {
        var raw = config[key];
        if (raw is not null && DateTimeOffset.TryParse(
                raw, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var value))
            apply(value);
    }

    private static void ApplyBool(IConfiguration config, string key, Action<bool> apply)
    {
        var raw = config[key];
        if (raw is not null && bool.TryParse(raw, out var value))
            apply(value);
    }

    private static void ApplyString(IConfiguration config, string key, Action<string> apply)
    {
        var raw = config[key];
        if (!string.IsNullOrEmpty(raw))
            apply(raw);
    }
}
