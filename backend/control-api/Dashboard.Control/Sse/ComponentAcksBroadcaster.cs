using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
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
/// </summary>
internal sealed class ComponentAcksBroadcaster
    : BackgroundService, IAckReadinessIndicator
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly IConfiguration _configuration;
    private readonly ILogger<ComponentAcksBroadcaster> _logger;

    private volatile bool _isListening;

    // Unbounded; the reset driver is the single consumer.
    private readonly Channel<ComponentAckMessage> _ackChannel =
        Channel.CreateUnbounded<ComponentAckMessage>(
            new UnboundedChannelOptions { SingleReader = false });

    // Pending raw payloads from the Notification callback.
    private readonly Channel<string> _pending =
        Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    public ComponentAcksBroadcaster(
        IConfiguration configuration,
        ILogger<ComponentAcksBroadcaster> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    // ── IAckReadinessIndicator ────────────────────────────────────────────────

    public bool IsAckListenerConnected => _isListening;

    // ── Public API for the reset driver ──────────────────────────────────────

    public ChannelReader<ComponentAckMessage> AckReader => _ackChannel.Reader;

    // ── BackgroundService ─────────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var broadcastTask = BroadcastAsync(stoppingToken);
        var listenTask = ListenWithRetryAsync(stoppingToken);
        await Task.WhenAll(listenTask, broadcastTask);
    }

    private async Task ListenWithRetryAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ListenAsync(ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ComponentAcksBroadcaster lost Postgres connection; reconnecting in 5 s.");
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }

        _pending.Writer.TryComplete();
        _ackChannel.Writer.TryComplete();
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var connectionString = _configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        conn.Notification += (_, args) => _pending.Writer.TryWrite(args.Payload);

        await using (var cmd = new NpgsqlCommand("LISTEN component_acks", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        _isListening = true;
        _logger.LogInformation("ComponentAcksBroadcaster: LISTEN component_acks active.");

        try
        {
            while (!ct.IsCancellationRequested)
                await conn.WaitAsync(ct);
        }
        finally
        {
            _isListening = false;
        }
    }

    private async Task BroadcastAsync(CancellationToken ct)
    {
        await foreach (var payload in _pending.Reader.ReadAllAsync(ct))
        {
            try
            {
                var msg = JsonSerializer.Deserialize<ComponentAckMessage>(payload, JsonOptions);
                if (msg is not null)
                    await _ackChannel.Writer.WriteAsync(msg, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ComponentAcksBroadcaster: error processing ack payload.");
            }
        }
    }
}
