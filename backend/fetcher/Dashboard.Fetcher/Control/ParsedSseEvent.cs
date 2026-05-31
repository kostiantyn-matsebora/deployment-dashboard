namespace Dashboard.Fetcher.Control;

/// <summary>
/// One parsed SSE frame from the control stream.
/// <para><c>IsPing</c> is true for <c>: ping</c> heartbeat lines (no <c>EventType</c> / <c>Id</c> / <c>Data</c>).</para>
/// </summary>
public sealed record ParsedSseEvent(
    bool IsPing,
    string? Id,
    string? EventType,
    string? Data);
