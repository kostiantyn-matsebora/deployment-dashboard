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
    IAsyncEnumerable<FetchResult> FetchAsync(string? cursor, CancellationToken ct);
}

/// <summary>Events are the canonical wire DTO — already tool-neutral.</summary>
public sealed record FetchResult(
    IReadOnlyList<DeploymentEventIngest> Events,
    string? Cursor);
