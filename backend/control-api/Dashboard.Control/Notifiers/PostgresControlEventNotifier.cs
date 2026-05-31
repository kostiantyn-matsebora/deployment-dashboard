using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Notifiers;

/// <summary>
/// Issues <c>NOTIFY control_events</c> with the serialised <see cref="ControlStreamEvent"/> JSON
/// as payload (§7 ch.2). The <see cref="Sse.ControlEventBroadcaster"/> deserialises this payload
/// directly and fans it out — no DB round-trip on the live path.
/// </summary>
internal sealed class PostgresControlEventNotifier(DashboardDbContext db) : IControlEventNotifier
{
    // Must match the snake_case policy the broadcaster uses when deserialising.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public async Task NotifyAsync(ControlStreamEvent ev, CancellationToken ct = default)
    {
        var payload = JsonSerializer.Serialize(ev, JsonOptions);
        await db.Database.ExecuteSqlAsync($"SELECT pg_notify('control_events', {payload})", ct);
    }
}
