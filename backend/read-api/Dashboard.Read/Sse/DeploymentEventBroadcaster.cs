using System.Collections.Concurrent;
using System.Threading.Channels;
using Dashboard.Read.Repositories;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Read.Sse;

/// <summary>
/// Singleton background service responsible for:
/// <list type="bullet">
///   <item>Holding one dedicated Npgsql connection with <c>LISTEN deployment_events</c>.</item>
///   <item>Fetching the full <see cref="DeploymentEvent"/> row for every notified id.</item>
///   <item>Fan-outing events to all active SSE subscriber channels.</item>
/// </list>
/// The LISTEN loop and the broadcast loop run concurrently via an internal
/// <see cref="Channel{T}"/> that decouples notification receipt from DB access.
/// </summary>
internal sealed class DeploymentEventBroadcaster : BackgroundService, IDeploymentEventBroadcaster, IReadinessIndicator
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DeploymentEventBroadcaster> _logger;

    // Volatile: written by the background LISTEN loop, read by the /readyz handler.
    private volatile bool _isListening;

    // Notification ids queued by the LISTEN callback; consumed by BroadcastAsync.
    private readonly Channel<Guid> _pending =
        Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    // Active subscriber channels keyed by their reader (the handle callers retain).
    private readonly ConcurrentDictionary<ChannelReader<DeploymentEvent>, ChannelWriter<DeploymentEvent>>
        _subscriptions = new();

    public DeploymentEventBroadcaster(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<DeploymentEventBroadcaster> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    // ── IReadinessIndicator ───────────────────────────────────────────────────

    public bool IsListenerConnected => _isListening;

    // ── IDeploymentEventBroadcaster ───────────────────────────────────────────

    public ChannelReader<DeploymentEvent> Subscribe()
    {
        var ch = Channel.CreateBounded<DeploymentEvent>(
            new BoundedChannelOptions(capacity: 256)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            });

        _subscriptions[ch.Reader] = ch.Writer;
        return ch.Reader;
    }

    public void Unsubscribe(ChannelReader<DeploymentEvent> reader)
    {
        if (_subscriptions.TryRemove(reader, out var writer))
            writer.TryComplete();
    }

    // ── Internal fan-out (exposed for unit tests via InternalsVisibleTo) ──────

    /// <summary>Writes <paramref name="ev"/> to every active subscriber channel.</summary>
    internal void Publish(DeploymentEvent ev)
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
                _logger.LogError(ex, "SSE broadcaster lost Postgres connection; reconnecting in 5 s.");
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

        await using (var cmd = new NpgsqlCommand("LISTEN deployment_events", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        _isListening = true;
        _logger.LogInformation("SSE broadcaster: LISTEN deployment_events active.");

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
                var ev = await FetchEventAsync(id, ct);
                if (ev is not null)
                    Publish(ev);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SSE broadcaster: error processing event {Id}.", id);
            }
        }
    }

    private async Task<DeploymentEvent?> FetchEventAsync(Guid id, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var repo = scope.ServiceProvider.GetRequiredService<IDeploymentReadRepository>();
        return await repo.GetByIdAsync(id, ct);
    }
}
