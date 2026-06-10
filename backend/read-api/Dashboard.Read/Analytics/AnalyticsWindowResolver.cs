namespace Dashboard.Read.Analytics;

/// <summary>
/// Resolves the <c>?window=</c> query parameter into a concrete <see cref="AnalyticsWindow"/>
/// record, clamping the requested span to <c>HISTORY_RETENTION_DAYS</c>.
/// </summary>
internal static class AnalyticsWindowResolver
{
    /// <summary>Valid window values as defined by the OpenAPI contract.</summary>
    private static readonly IReadOnlyDictionary<string, int> WindowDays =
        new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)
        {
            ["7d"] = 7,
            ["14d"] = 14,
            ["30d"] = 30,
        };

    /// <summary>
    /// Resolves the requested <paramref name="window"/> (e.g. "7d") against
    /// <paramref name="retentionDays"/>.
    /// <para>
    /// An absent or out-of-enum value resolves to the 7-day default per contract.
    /// When the requested span exceeds <paramref name="retentionDays"/> the effective
    /// days are clamped and <c>Clamped</c> is <c>true</c>.
    /// </para>
    /// <para>
    /// <c>to</c> is truncated to the start of the current UTC day so that two logically
    /// identical requests within the same UTC day produce the same <c>from</c>/<c>to</c>,
    /// the same serialised response, and therefore the same ETag — enabling
    /// <c>If-None-Match → 304</c> to function correctly across requests.
    /// </para>
    /// </summary>
    internal static AnalyticsWindow Resolve(
        string? window,
        int retentionDays,
        DateTimeOffset now)
    {
        var requestedDays = WindowDays.GetValueOrDefault(window ?? string.Empty, 7);
        var clamped = requestedDays > retentionDays;
        var effectiveDays = clamped ? retentionDays : requestedDays;

        // Truncate to day boundary so the ETag is stable for the full UTC day.
        var todayUtc = now.UtcDateTime.Date;
        var to = new DateTimeOffset(todayUtc, TimeSpan.Zero);
        var from = to.AddDays(-effectiveDays);

        return new AnalyticsWindow(effectiveDays, from, to, retentionDays, clamped);
    }
}
