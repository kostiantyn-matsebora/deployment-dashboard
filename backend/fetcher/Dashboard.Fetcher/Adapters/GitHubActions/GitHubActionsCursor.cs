using System.Globalization;

namespace Dashboard.Fetcher.Adapters.GitHubActions;

/// <summary>
/// Internal cursor helper for the GitHub Actions adapter (ADR-0004
/// Decision 2 — adapter-owned opaque cursor). The on-wire shape is the
/// largest seen <c>deployment.id</c> rendered as a decimal string; this
/// helper centralises parse / format so the adapter never has to worry
/// about culture / radix / overflow.
///
/// <para>The backend treats the value as opaque; <strong>only</strong> the
/// GHA adapter knows the cursor is numeric.</para>
/// </summary>
internal static class GitHubActionsCursor
{
    /// <summary>
    /// Parse the cursor blob into a watermark. Returns <c>0</c> when the
    /// cursor is null / empty / unparseable — both meaning "no prior cursor;
    /// treat as first fetch" (the adapter's contract: a buggy cursor is
    /// recoverable, see ADR-0004 Consequences).
    /// </summary>
    public static long Parse(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return 0;
        return long.TryParse(cursor, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) && v > 0
            ? v
            : 0;
    }

    /// <summary>Format a watermark as the opaque cursor blob.</summary>
    public static string Format(long watermark) =>
        watermark.ToString(CultureInfo.InvariantCulture);
}
