namespace Dashboard.Control;

/// <summary>
/// Exposes readiness of the <c>component_events</c> LISTEN connection (Channel 4, §7 ch.4).
/// Consumed by the <c>GET /readyz</c> probe in the API host — all four LISTEN channels must
/// be attached before the probe returns <c>ready</c> (D10, §5 readyz).
/// Kept narrow (ISP), mirroring <c>IControlReadinessIndicator</c>.
/// </summary>
public interface IComponentEventReadinessIndicator
{
    /// <summary><c>true</c> when the PostgreSQL <c>LISTEN component_events</c> connection is active.</summary>
    bool IsComponentEventListenerConnected { get; }
}
