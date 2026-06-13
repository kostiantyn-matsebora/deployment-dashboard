namespace Dashboard.Read.Analytics;

/// <summary>
/// Parsed, ready-to-use analytics configuration.
/// Constructed once at the composition root and registered as a singleton — all env vars
/// are parsed a single time, never per-request.
/// </summary>
/// <param name="FunnelEnvironments">
/// Ordered funnel ladder (lowercase-normalized). The last element is the production terminal
/// used as the lead-time boundary. Guaranteed non-empty.
/// </param>
/// <param name="Granularity">
/// Controls whether <c>to</c> is truncated to the start of the UTC day or the UTC hour.
/// </param>
/// <param name="RetentionDays">
/// Effective history retention in days (clamped to a minimum of 90; defaults to 365).
/// </param>
internal sealed record AnalyticsOptions(
    string[] FunnelEnvironments,
    AnalyticsWindowGranularity Granularity,
    int RetentionDays);
