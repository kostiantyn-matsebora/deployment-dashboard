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
    /// How far back backfill scans per environment.
    /// Falls back to <see cref="InitialLookback"/> when zero (§6).
    /// </summary>
    public TimeSpan BackfillMaxAge { get; set; } = TimeSpan.Zero;

    public TimeSpan EffectiveBackfillMaxAge =>
        BackfillMaxAge > TimeSpan.Zero ? BackfillMaxAge : InitialLookback;

    public TimeSpan PollInterval => TimeSpan.FromSeconds(PollIntervalSeconds);
}
