namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues a <c>pg_notify('component_events', &lt;id&gt;)</c> after each successful component-event
/// insert, so the <see cref="Sse.ComponentEventBroadcaster"/> can fan the record out to live
/// <c>GET /api/control/events/stream</c> subscribers (§7 ch.4, id-only NOTIFY pattern).
/// </summary>
internal interface IComponentEventNotifier
{
    Task NotifyAsync(Guid eventId, CancellationToken ct = default);
}
