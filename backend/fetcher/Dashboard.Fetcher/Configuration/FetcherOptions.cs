namespace Dashboard.Fetcher.Configuration;

/// <summary>Global fetcher settings (§6). Shared by the host and adapters.</summary>
public sealed class FetcherOptions
{
    public int PollIntervalSeconds { get; set; } = 30;

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

    public TimeSpan PollInterval => TimeSpan.FromSeconds(PollIntervalSeconds);
}
