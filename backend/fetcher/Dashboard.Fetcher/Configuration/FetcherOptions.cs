namespace Dashboard.Fetcher.Configuration;

/// <summary>Global fetcher settings (§6). Shared by the host and adapters.</summary>
public sealed class FetcherOptions
{
    public int PollIntervalSeconds { get; set; } = 30;

    /// <summary>
    /// Slow-cadence preset-discovery loop interval (issue #391 / §5.6.2) — SEPARATE from
    /// <see cref="PollIntervalSeconds"/>. Discovery lists each configured repo's
    /// <c>.deployment-dashboard</c> directory and publishes its preset bundle; it runs far
    /// less often than the deployment poll loop. Default 3600 (1h).
    /// </summary>
    public int DiscoveryIntervalSeconds { get; set; } = 3600;

    /// <summary>Normal poll first-run window; also default for BackfillMaxAge (F7).</summary>
    public TimeSpan InitialLookback { get; set; } = TimeSpan.FromDays(7);

    /// <summary>Set true to force a backfill run regardless of cursor state (F14).</summary>
    public bool Backfill { get; set; } = false;

    /// <summary>
    /// Number of latest status events to seed per (service, environment) slot during backfill (F13).
    /// Default 2 — seeds the two most recent mapped status events per slot.
    /// </summary>
    public int BackfillDepth { get; set; } = 2;

    /// <summary>
    /// How far back backfill scans per environment.
    /// Falls back to <see cref="InitialLookback"/> when zero (§6).
    /// </summary>
    public TimeSpan BackfillMaxAge { get; set; } = TimeSpan.Zero;

    /// <summary>
    /// Optional fixed clock for window computation (test seam, via <c>FETCHER_NOW</c>).
    /// When set, the backfill anchor and the <c>now − InitialLookback</c> fallback use
    /// this instant instead of wall-clock now, so static fixtures with hardcoded dates
    /// never age out of the lookback window. Unset in production → real <c>UtcNow</c>.
    /// </summary>
    public DateTimeOffset? NowOverride { get; set; }

    /// <summary>
    /// <c>X-Control-API-Key</c> for <c>GET /api/control/stream</c>.
    /// Distinct from <c>API_KEY</c> per §5.10.2 / api-guidelines §4 (D8).
    /// </summary>
    public string ControlApiKey { get; set; } = "";

    /// <summary>
    /// <c>X-Component-Id</c> sent on <c>POST /api/control/events</c>.
    /// MUST match the API's <c>ExpectedComponents</c> for acks to be counted — default is
    /// <c>dashboard-fetcher</c> (§5.10.1).
    /// </summary>
    public string ComponentId { get; set; } = "dashboard-fetcher";

    public TimeSpan EffectiveBackfillMaxAge =>
        BackfillMaxAge > TimeSpan.Zero ? BackfillMaxAge : InitialLookback;

    /// <summary>Current instant for window computation — <see cref="NowOverride"/> when set, else wall clock.</summary>
    public DateTimeOffset UtcNow => NowOverride ?? DateTimeOffset.UtcNow;

    public TimeSpan PollInterval => TimeSpan.FromSeconds(PollIntervalSeconds);

    /// <summary>Interval for the slow-cadence discovery loop (issue #391 / §5.6.2).</summary>
    public TimeSpan DiscoveryInterval => TimeSpan.FromSeconds(DiscoveryIntervalSeconds);
}
