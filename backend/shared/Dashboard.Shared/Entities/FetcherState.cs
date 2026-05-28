namespace Dashboard.Shared.Entities;

/// <summary>
/// Per-adapter opaque cursor persisted by <c>Dashboard.Fetcher</c> via
/// <c>GET/PUT /api/fetcher/state/{adapter}</c>.
/// This is the only non-append-only table in the system.
/// </summary>
public sealed class FetcherState
{
    /// <summary>Adapter identifier (lowercase kebab, e.g. <c>github-actions</c>). Primary key.</summary>
    public required string Adapter { get; set; }

    /// <summary>Opaque cursor blob. Max 8 KiB. Content is never parsed by the backend.</summary>
    public required string Cursor { get; set; }

    /// <summary>Timestamp of the most recent write. Latest write wins.</summary>
    public DateTimeOffset UpdatedAt { get; set; }
}
