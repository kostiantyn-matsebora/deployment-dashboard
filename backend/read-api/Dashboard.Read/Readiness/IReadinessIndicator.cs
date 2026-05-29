namespace Dashboard.Read;

/// <summary>
/// Exposes operational readiness state of the <c>Dashboard.Read</c> layer.
/// Consumed by the <c>GET /readyz</c> probe in the API host.
/// Kept deliberately narrow (ISP): callers only need the readiness flag, not
/// the full broadcaster subscription API.
/// </summary>
public interface IReadinessIndicator
{
    /// <summary>
    /// <c>true</c> when the PostgreSQL <c>LISTEN deployment_events</c> connection is active.
    /// <c>false</c> at startup (before the connection is established) or after a disconnection
    /// (retrying). SSE replay still works when <c>false</c>; live fan-out does not.
    /// </summary>
    bool IsListenerConnected { get; }
}
