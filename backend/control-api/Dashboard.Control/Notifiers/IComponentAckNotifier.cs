namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues <c>NOTIFY component_acks</c> with a JSON payload carrying
/// <c>component_id</c> and <c>reset_id</c> so the ack broadcaster can deliver
/// the message to the driving reset instance (§7 ch.3).
/// </summary>
internal interface IComponentAckNotifier
{
    Task NotifyAsync(string componentId, string resetId, CancellationToken ct = default);
}
