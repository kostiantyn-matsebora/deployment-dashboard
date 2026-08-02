using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.Abstractions;

/// <summary>
/// The ONLY surface the host knows. No GitHub/ADO/Jenkins type ever appears here (F2).
/// </summary>
public interface ICiCdAdapter
{
    /// <summary>
    /// Stable, lowercase-kebab id. Used as the X-Progress-Reporter suffix
    /// (dashboard-fetcher/&lt;id&gt;) and the /api/fetcher/state/{adapter} key.
    /// </summary>
    string AdapterId { get; }

    /// <summary>
    /// Streams chunks of events newer than <paramref name="cursor"/> (null = first run).
    /// Each yielded <see cref="FetchResult"/> carries the events for that chunk plus the
    /// full advanced cursor as of that chunk (opaque to the host).
    /// Backfill yields one chunk per (repo, environment) plus a zero-event completion
    /// marker per repo. Normal poll yields a single chunk.
    /// At-least-once (F5): a throw mid-stream leaves the cursor at the last persisted
    /// chunk; the next poll re-delivers the failed chunk (duplicates are acceptable).
    /// </summary>
    /// <summary>
    /// Resets all in-memory fetch state to first-run, invoked on the reset saga's
    /// <c>reset-completed</c> step (alongside dropping the cursor). Clears any dedup
    /// caches / high-water optimizations so the next <see cref="FetchAsync"/> re-fetches
    /// from scratch. Default no-op; adapters that hold caches override it.
    /// </summary>
    void ResetState() { }

    /// <summary>
    /// Recover saga (§5.10.6): builds a rewound cursor with every known target's high-water
    /// mark set to <paramref name="since"/> and NO backfill markers, so the next
    /// <see cref="FetchAsync"/> call takes the incremental poll branch. Recover is
    /// non-destructive — unlike <see cref="ResetState"/> paired with a null cursor (which
    /// triggers backfill), recovery must never re-enter backfill. Implementations also clear
    /// any in-memory windowed dedup caches (same effect as <see cref="ResetState"/>) so a
    /// warm conditional-request hit does not reuse the narrow pre-rewind window and miss the
    /// gap being recovered.
    /// Default: not supported — adapters that hold no per-target cursor state should not be
    /// targeted by a recover command. Adapters that support recovery override this.
    /// </summary>
    string RewindTo(DateTimeOffset since) =>
        throw new NotSupportedException($"{GetType().Name} does not support recovery rewind.");

    IAsyncEnumerable<FetchResult> FetchAsync(string? cursor, CancellationToken ct);
}

/// <summary>Events are the canonical wire DTO — already tool-neutral.</summary>
public sealed record FetchResult(
    IReadOnlyList<DeploymentEventIngest> Events,
    string? Cursor);
