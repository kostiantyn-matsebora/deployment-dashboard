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
    /// Poll the source for events newer than <paramref name="cursor"/> (null = first run).
    /// Returns the events to push and the advanced cursor (opaque to the host).
    /// </summary>
    Task<FetchResult> FetchAsync(string? cursor, CancellationToken ct);
}

/// <summary>Events are the canonical wire DTO — already tool-neutral.</summary>
public sealed record FetchResult(
    IReadOnlyList<DeploymentEventIngest> Events,
    string? Cursor);
