using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues <c>NOTIFY component_acks</c> with payload <c>{"component_id":…,"reset_id":…}</c>
/// so the <c>ComponentAcksBroadcaster</c> can fan the ack to the driving reset instance (§7 ch.3).
/// </summary>
/// <summary>
/// Issues <c>NOTIFY component_acks</c> with payload <c>{"component_id":…,"correlation_id":…}</c>
/// so the <c>ComponentAcksBroadcaster</c> can fan the ack to the driving reset instance (§7 ch.3).
/// </summary>
internal sealed class PostgresComponentAckNotifier(DashboardDbContext db) : IComponentAckNotifier
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task NotifyAsync(string componentId, string correlationId, CancellationToken ct = default)
    {
        var payload = JsonSerializer.Serialize(
            new { ComponentId = componentId, CorrelationId = correlationId },
            JsonOptions);
        // Use ExecuteSqlAsync with FormattableString so EF Core parameterises the payload correctly.
        await db.Database.ExecuteSqlAsync($"SELECT pg_notify('component_acks', {payload})", ct);
    }
}
