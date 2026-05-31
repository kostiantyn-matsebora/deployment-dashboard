namespace Dashboard.Control;

/// <summary>
/// Exposes readiness of the control-plane LISTEN connection (D10).
/// Consumed by the <c>GET /readyz</c> probe in the API host, which requires BOTH
/// the deployment and control channels attached before returning <c>ready</c>.
/// Kept narrow (ISP), mirroring <c>Dashboard.Read.IReadinessIndicator</c>.
/// </summary>
public interface IControlReadinessIndicator
{
    /// <summary><c>true</c> when the PostgreSQL <c>LISTEN control_events</c> connection is active.</summary>
    bool IsControlListenerConnected { get; }
}
