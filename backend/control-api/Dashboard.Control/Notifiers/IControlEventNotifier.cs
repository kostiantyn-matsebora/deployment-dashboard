using Dashboard.Shared.Entities;

namespace Dashboard.Control.Notifiers;

/// <summary>
/// Announces a control event on the PostgreSQL <c>control_events</c> channel so that
/// live <c>GET /api/control/stream</c> subscribers receive it. Mirrors <c>IDeploymentNotifier</c>.
/// </summary>
internal interface IControlEventNotifier
{
    Task NotifyAsync(ControlStreamEvent ev, CancellationToken ct = default);
}
