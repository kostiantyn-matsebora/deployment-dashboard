using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Dashboard.Shared.Sse;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Sse;

/// <summary>
/// Singleton background service that:
/// <list type="bullet">
///   <item>Holds one dedicated Npgsql connection with <c>LISTEN component_acks</c>.</item>
///   <item>Deserialises each NOTIFY payload (<c>{component_id, reset_id}</c>).</item>
///   <item>Queues the ack message into a <see cref="Channel{T}"/> for the reset driver to consume.</item>
/// </list>
/// Mirrors <see cref="ControlEventBroadcaster"/> but for the third channel (D10, §7 ch.3).
/// No subscriber fan-out: the reset driver is the single consumer via <see cref="AckReader"/>.
/// </summary>
internal sealed class ComponentAcksBroadcaster
    : PgListenBroadcasterBase<string>, IAckReadinessIndicator
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    // Unbounded; the reset driver is the single consumer.
    private readonly Channel<ComponentAckMessage> _ackChannel =
        Channel.CreateUnbounded<ComponentAckMessage>(
            new UnboundedChannelOptions { SingleReader = false });

    public ComponentAcksBroadcaster(
        NpgsqlDataSource dataSource,
        ILogger<ComponentAcksBroadcaster> logger)
        : base(dataSource, logger) { }

    // ── IAckReadinessIndicator ────────────────────────────────────────────────

    public bool IsAckListenerConnected => IsListening;

    // ── Public API for the reset driver ──────────────────────────────────────

    public ChannelReader<ComponentAckMessage> AckReader => _ackChannel.Reader;

    // ── PgListenBroadcasterBase<string> ───────────────────────────────────────

    protected override string PgChannelName => "component_acks";

    // The full JSON payload is the notification — always valid.
    protected override bool TryParseNotification(string payload, out string item)
    {
        item = payload;
        return true;
    }

    protected override async Task ProcessAsync(string payload, CancellationToken ct)
    {
        var msg = JsonSerializer.Deserialize<ComponentAckMessage>(payload, JsonOptions);
        if (msg is not null)
            await _ackChannel.Writer.WriteAsync(msg, ct);
    }

    // Complete the ack channel so AckReader consumers exit cleanly when the LISTEN loop stops.
    protected override void OnListenLoopExited() => _ackChannel.Writer.TryComplete();
}
