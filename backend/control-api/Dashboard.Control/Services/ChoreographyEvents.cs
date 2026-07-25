using Dashboard.Shared.Entities;

namespace Dashboard.Control.Services;

/// <summary>
/// Builds a <see cref="ControlStreamEvent"/> for a choreography transition (<c>*-started</c>,
/// <c>*-completed</c>) — shared by <see cref="ResetOrchestrator"/> and
/// <see cref="RecoverOrchestrator"/>. <paramref name="payload"/> is the operation-specific hook:
/// reset never carries one (omitted → null, same as the property's default); recover carries the
/// resolved <c>{"since":"…"}</c> (<see cref="RecoverPayload"/>) on <c>recover-completed</c>.
/// </summary>
internal static class ChoreographyEvents
{
    public static ControlStreamEvent Build(string type, Guid correlationId, string? payload = null) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = type,
            Component = "*",
            CorrelationId = correlationId,
            OccurredAt = DateTimeOffset.UtcNow,
            Payload = payload,
        };
}
