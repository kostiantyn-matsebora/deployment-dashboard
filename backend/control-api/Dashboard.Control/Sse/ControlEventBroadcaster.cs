using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Entities;
using Dashboard.Shared.Sse;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Sse;

/// <summary>
/// Singleton background service that:
/// <list type="bullet">
///   <item>Holds one dedicated Npgsql connection with <c>LISTEN control_events</c>.</item>
///   <item>Deserialises each NOTIFY payload (a full <see cref="ControlStreamEvent"/> JSON, §7 ch.2).</item>
///   <item>Fans the event out to all active control-stream subscriber channels.</item>
/// </list>
/// Mirrors <c>DeploymentEventBroadcaster</c>, but the NOTIFY payload carries the whole event
/// (not just an id), so no DB round-trip is needed on the live path.
/// </summary>
internal sealed class ControlEventBroadcaster
    : PgListenFanOutBase<string, ControlStreamEvent>, IControlEventBroadcaster, IControlReadinessIndicator
{
    // Must match the global snake_case HttpJsonOptions used when emitting the NOTIFY payload.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public ControlEventBroadcaster(
        IConfiguration configuration,
        ILogger<ControlEventBroadcaster> logger)
        : base(configuration, logger) { }

    // ── IControlReadinessIndicator ────────────────────────────────────────────

    public bool IsControlListenerConnected => IsListening;

    // ── PgListenFanOutBase<string, ControlStreamEvent> ────────────────────────

    protected override string PgChannelName => "control_events";

    // The full JSON payload is the notification — always valid.
    protected override bool TryParseNotification(string payload, out string item)
    {
        item = payload;
        return true;
    }

    protected override Task<ControlStreamEvent?> ResolveAsync(string payload, CancellationToken ct)
    {
        var ev = JsonSerializer.Deserialize<ControlStreamEvent>(payload, JsonOptions);
        return Task.FromResult(ev);
    }
}
