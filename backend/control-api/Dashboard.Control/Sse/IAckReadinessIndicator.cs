namespace Dashboard.Control.Sse;

/// <summary>
/// Reports whether the <c>component_acks</c> LISTEN channel is attached —
/// one of the three readiness prerequisites (D10, §5 readyz).
/// </summary>
public interface IAckReadinessIndicator
{
    bool IsAckListenerConnected { get; }
}
