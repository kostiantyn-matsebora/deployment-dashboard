using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

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
    : BackgroundService, IControlEventBroadcaster, IControlReadinessIndicator
{
    // Must match the global snake_case HttpJsonOptions used when emitting the NOTIFY payload.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly IConfiguration _configuration;
    private readonly ILogger<ControlEventBroadcaster> _logger;

    // Volatile: written by the background LISTEN loop, read by the /readyz handler.
    private volatile bool _isListening;

    // Raw payloads queued by the LISTEN callback; consumed by BroadcastAsync.
    private readonly Channel<string> _pending =
        Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    // Active subscriber channels keyed by their reader (the handle callers retain).
    private readonly ConcurrentDictionary<ChannelReader<ControlStreamEvent>, ChannelWriter<ControlStreamEvent>>
        _subscriptions = new();

    public ControlEventBroadcaster(
        IConfiguration configuration,
        ILogger<ControlEventBroadcaster> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    // ── IControlReadinessIndicator ────────────────────────────────────────────

    public bool IsControlListenerConnected => _isListening;

    // ── IControlEventBroadcaster ──────────────────────────────────────────────

    public ChannelReader<ControlStreamEvent> Subscribe()
    {
        var ch = Channel.CreateBounded<ControlStreamEvent>(
            new BoundedChannelOptions(capacity: 256)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            });

        _subscriptions[ch.Reader] = ch.Writer;
        return ch.Reader;
    }

    public void Unsubscribe(ChannelReader<ControlStreamEvent> reader)
    {
        if (_subscriptions.TryRemove(reader, out var writer))
            writer.TryComplete();
    }

    // ── Internal fan-out (exposed for unit tests via InternalsVisibleTo) ──────

    internal void Publish(ControlStreamEvent ev)
    {
        foreach (var (_, writer) in _subscriptions)
            writer.TryWrite(ev);
    }

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
                _logger.LogError(ex, "Control broadcaster lost Postgres connection; reconnecting in 5 s.");
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }

        _pending.Writer.TryComplete();
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var connectionString = _configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        conn.Notification += (_, args) => _pending.Writer.TryWrite(args.Payload);

        await using (var cmd = new NpgsqlCommand("LISTEN control_events", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        _isListening = true;
        _logger.LogInformation("Control broadcaster: LISTEN control_events active.");

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
                var ev = JsonSerializer.Deserialize<ControlStreamEvent>(payload, JsonOptions);
                if (ev is not null)
                    Publish(ev);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Control broadcaster: error processing notification payload.");
            }
        }
    }
}
