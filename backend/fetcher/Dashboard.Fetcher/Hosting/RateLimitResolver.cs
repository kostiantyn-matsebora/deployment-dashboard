namespace Dashboard.Fetcher.Hosting;

/// <summary>
/// Pure function that resolves the fetcher's self-imposed absolute cap for
/// the current upstream rate-limit window (CR-0011 § 3a). Inputs are the
/// operator-supplied <see cref="FetcherOptions.RateLimitAbsolute"/> +
/// <see cref="FetcherOptions.RateLimitPercentage"/> and the most-recently
/// observed upstream budget; output is the absolute number of requests
/// the fetcher will allow itself this window.
///
/// <para>Precedence (CR-0011 § 3a — "absolute wins when both are set"):</para>
/// <list type="number">
///   <item>If <see cref="FetcherOptions.RateLimitAbsolute"/> is non-null
///   and positive → return it verbatim (operator-explicit absolute cap).</item>
///   <item>Else if <see cref="FetcherOptions.RateLimitPercentage"/> is
///   set → return <c>floor(upstreamLimit × percentage / 100)</c>.</item>
///   <item>Else → fall back to the framework default of
///   <see cref="DefaultPercentage"/>% (CR-0011 § 3a — "default 30").</item>
/// </list>
///
/// <para>The percentage path multiplies against the upstream-reported
/// total (e.g. GHA's <c>X-RateLimit-Limit</c>) — NOT against any
/// fetcher-side counter. ADR-0008 Decision 1 keeps the upstream provider
/// as the single source of truth for "how many requests left in the
/// window" so the fetcher carries no per-window state across restarts.</para>
///
/// <para>Validation of operator inputs (negative absolute, percentage out
/// of 1..100) is enforced in
/// <see cref="DependencyInjection.ServiceCollectionExtensions.AddCiCdFetcher"/>
/// at startup — this resolver assumes the inputs are already valid (its
/// only job is precedence resolution + the percentage multiply).</para>
/// </summary>
public static class RateLimitResolver
{
    /// <summary>
    /// Framework default percentage applied when neither
    /// <see cref="FetcherOptions.RateLimitAbsolute"/> nor
    /// <see cref="FetcherOptions.RateLimitPercentage"/> is set
    /// (CR-0011 § 3a — "default 30").
    /// </summary>
    public const int DefaultPercentage = 30;

    /// <summary>
    /// Resolve the absolute cap for the supplied <paramref name="options"/>
    /// against the observed <paramref name="upstreamLimit"/>. The cap is
    /// guaranteed to be at least <c>1</c> when <paramref name="upstreamLimit"/>
    /// is positive (a tick that would resolve to <c>0</c> would skip every
    /// request indefinitely; the operator's intent of "self-impose a
    /// percentage" is preserved by rounding up to one request).
    /// </summary>
    public static int Resolve(FetcherOptions options, int upstreamLimit)
    {
        ArgumentNullException.ThrowIfNull(options);

        // Absolute wins when set + positive — operator explicit override.
        if (options.RateLimitAbsolute is int abs && abs > 0)
        {
            return abs;
        }

        // Otherwise compute from percentage (with framework default fallback).
        var pct = options.RateLimitPercentage ?? DefaultPercentage;

        // Defensive: a non-positive upstreamLimit means "we don't know the
        // budget yet" — return 0 so the caller's gate stays inert until a
        // real observation arrives.
        if (upstreamLimit <= 0) return 0;

        // floor(upstreamLimit * pct / 100); long arithmetic guards against
        // integer overflow on big upstream budgets paired with high pct.
        var resolved = (int)((long)upstreamLimit * pct / 100L);
        return resolved < 1 ? 1 : resolved;
    }

    /// <summary>
    /// Whether the operator opted into the absolute-cap mode for the
    /// startup log line + the usage push payload. Mirrors the
    /// "absolute-wins" precedence used by <see cref="Resolve"/>.
    /// </summary>
    public static bool IsAbsoluteMode(FetcherOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return options.RateLimitAbsolute is int abs && abs > 0;
    }
}
