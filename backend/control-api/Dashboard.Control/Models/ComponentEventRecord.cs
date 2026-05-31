using System.Text.Json;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Models;

/// <summary>
/// Response item for <c>GET /api/control/events</c> (OpenAPI <c>ComponentEventRecord</c>).
/// Serialised with the global snake_case policy. <see cref="Payload"/> is emitted as a raw
/// JSON object (not a quoted string) by reparsing the stored verbatim blob.
/// </summary>
public sealed record ComponentEventRecord(
    Guid Id,
    string ComponentId,
    string EventType,
    string State,
    string? Detail,
    DateTimeOffset OccurredAt,
    DateTimeOffset ReceivedAt,
    JsonElement? Payload)
{
    internal static ComponentEventRecord FromEntity(ComponentEvent e)
    {
        JsonElement? payload = e.Payload is { Length: > 0 }
            ? JsonDocument.Parse(e.Payload).RootElement.Clone()
            : null;

        return new ComponentEventRecord(
            e.Id, e.ComponentId, e.EventType, e.State, e.Detail, e.OccurredAt, e.ReceivedAt, payload);
    }
}
