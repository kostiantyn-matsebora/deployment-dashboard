namespace Dashboard.Control.Sse;

/// <summary>
/// Deserialized payload of a <c>NOTIFY component_acks</c> message.
/// Carries the component id and the reset cycle id so the driver can count acks
/// for the correct cycle and ignore stale/duplicate payloads (§7 ch.3).
/// </summary>
/// <summary>
/// Deserialized payload of a <c>NOTIFY component_acks</c> message.
/// Carries the component id and the correlation id so the driver can count acks
/// for the correct cycle and ignore stale/duplicate payloads (§7 ch.3).
/// </summary>
internal sealed record ComponentAckMessage(string ComponentId, string CorrelationId);
