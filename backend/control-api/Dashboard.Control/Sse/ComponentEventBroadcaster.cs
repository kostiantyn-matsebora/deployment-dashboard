using System.Collections.Concurrent;
using System.Threading.Channels;
using Dashboard.Control.Models;
using Dashboard.Control.Repositories;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Sse;

/// <summary>
/// Singleton background service responsible for:
/// <list type="bullet">
///   <item>Holding one dedicated Npgsql connection with <c>LISTEN component_events</c>.</item>
///   <item>Fetching the full <see cref="Dashboard.Shared.Entities.ComponentEvent"/> row for every notified id.</item>
///   <item>Fan-outing <see cref="ComponentEventRecord"/> values to all active SSE subscriber channels.</item>
/// </list>
/// Mirrors <c>DeploymentEventBroadcaster</c>: the NOTIFY payload carries the row <c>id</c> only
/// (not the full JSON) because a component payload can reach 8 KiB, exceeding the Postgres NOTIFY limit
/// (§7 ch.4, API spec).
/// </summary>
internal sealed class ComponentEventBroadcaster
    : BackgroundService, IComponentEventBroadcaster, IComponentEventReadinessIndicator
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<ComponentEventBroadcaster> _logger;

    // Volatile: written by the background LISTEN loop, read by the /readyz handler.
    private volatile bool _isListening;

    // Notification ids queued by the LISTEN callback; consumed by BroadcastAsync.
    private readonly Channel<Guid> _pending =
        Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    // Active subscriber channels keyed by their reader (the handle callers retain).
    private readonly ConcurrentDictionary<ChannelReader<ComponentEventRecord>, ChannelWriter<ComponentEventRecord>>
        _subscriptions = new();

    public ComponentEventBroadcaster(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<ComponentEventBroadcaster> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    // ── IComponentEventReadinessIndicator ─────────────────────────────────────

    public bool IsComponentEventListenerConnected => _isListening;

    // ── IComponentEventBroadcaster ────────────────────────────────────────────

    public ChannelReader<ComponentEventRecord> Subscribe()
    {
        var ch = Channel.CreateBounded<ComponentEventRecord>(
            new BoundedChannelOptions(capacity: 256)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            });

        _subscriptions[ch.Reader] = ch.Writer;
        return ch.Reader;
    }

    public void Unsubscribe(ChannelReader<ComponentEventRecord> reader)
    {
        if (_subscriptions.TryRemove(reader, out var writer))
            writer.TryComplete();
    }

    // ── Internal fan-out (exposed for unit tests via InternalsVisibleTo) ──────

    /// <summary>Writes <paramref name="record"/> to every active subscriber channel.</summary>
    internal void Publish(ComponentEventRecord record)
    {
        foreach (var (_, writer) in _subscriptions)
            writer.TryWrite(record);
    }

    // ── BackgroundService ─────────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var broadcastTask = BroadcastAsync(stoppingToken);
        var listenTask = ListenWithRetryAsync(stoppingToken);
        await Task.WhenAll(listenTask, broadcastTask);
    }

    // ── LISTEN loop (reconnects on failure) ───────────────────────────────────

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
                _logger.LogError(ex, "Component-event broadcaster lost Postgres connection; reconnecting in 5 s.");
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }

        // Signal the broadcast loop to drain and exit.
        _pending.Writer.TryComplete();
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var connectionString = _configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        conn.Notification += (_, args) =>
        {
            if (Guid.TryParse(args.Payload, out var id))
                _pending.Writer.TryWrite(id);
        };

        await using (var cmd = new NpgsqlCommand("LISTEN component_events", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        _isListening = true;
        _logger.LogInformation("Component-event broadcaster: LISTEN component_events active.");

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

    // ── Broadcast loop ────────────────────────────────────────────────────────

    private async Task BroadcastAsync(CancellationToken ct)
    {
        await foreach (var id in _pending.Reader.ReadAllAsync(ct))
        {
            try
            {
                var record = await FetchRecordAsync(id, ct);
                if (record is not null)
                    Publish(record);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Component-event broadcaster: error processing event {Id}.", id);
            }
        }
    }

    private async Task<ComponentEventRecord?> FetchRecordAsync(Guid id, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IComponentEventRepository>();
        var entity = await repo.GetByIdAsync(id, ct);
        return entity is null ? null : ComponentEventRecord.FromEntity(entity);
    }
}
