namespace Dashboard.Fetcher.Control;

/// <summary>
/// Subscribes to <c>GET /api/control/stream</c> and yields parsed SSE events (§5.10.2).
/// Caller sets <c>Last-Event-ID</c> via <paramref name="lastEventId"/> on reconnect.
/// </summary>
public interface IControlStreamClient
{
    /// <summary>
    /// Opens the control stream and yields events until <paramref name="ct"/> is cancelled
    /// or the server closes the connection. The caller is responsible for reconnect loops.
    /// </summary>
    IAsyncEnumerable<ParsedSseEvent> StreamAsync(string? lastEventId, CancellationToken ct);
}
