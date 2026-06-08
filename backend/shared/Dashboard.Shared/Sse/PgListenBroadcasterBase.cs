using System.Threading.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Shared.Sse;

/// <summary>
/// Abstract base for singleton background services that hold one dedicated
/// Npgsql connection with a <c>LISTEN &lt;channel&gt;</c> command and process
/// each notification payload.
/// </summary>
/// <remarks>
/// <para>
/// Concrete subclasses provide three things:
/// <list type="bullet">
///   <item>The Postgres channel name via <see cref="PgChannelName"/>.</item>
///   <item>Notification parsing via <see cref="TryParseNotification"/>.</item>
///   <item>Per-item processing via <see cref="ProcessAsync"/>.</item>
/// </list>
/// </para>
/// <para>
/// The LISTEN loop and the processing loop run concurrently through an internal
/// <see cref="Channel{T}"/> that decouples notification receipt from processing.
/// The LISTEN loop reconnects automatically after any non-cancellation exception.
/// </para>
/// </remarks>
/// <typeparam name="TPending">
/// The type queued from the LISTEN callback into the internal channel
/// (typically <see cref="Guid"/> for id-based notifications or <see cref="string"/>
/// for full-payload notifications).
/// </typeparam>
public abstract class PgListenBroadcasterBase<TPending> : BackgroundService
{
    private readonly IConfiguration _configuration;
    // Volatile: written by the background LISTEN loop, read by the /readyz handler.
    private volatile bool _isListening;

    // Notification items queued by the LISTEN callback; consumed by the process loop.
    private readonly Channel<TPending> _pending =
        Channel.CreateUnbounded<TPending>(new UnboundedChannelOptions { SingleReader = true });

    /// <summary>Initialises the base with the configuration and logger.</summary>
    protected PgListenBroadcasterBase(
        IConfiguration configuration,
        ILogger logger)
    {
        _configuration = configuration;
        Logger = logger;
    }

    // ── Subclass contract ─────────────────────────────────────────────────────

    /// <summary>The PostgreSQL <c>LISTEN</c> channel name (e.g. <c>"deployment_events"</c>).</summary>
    protected abstract string PgChannelName { get; }

    /// <summary>
    /// Converts a raw Postgres NOTIFY payload string into the pending item type.
    /// Returns <c>true</c> and sets <paramref name="item"/> when the payload is valid;
    /// returns <c>false</c> to skip the notification.
    /// </summary>
    protected abstract bool TryParseNotification(string payload, out TPending item);

    /// <summary>
    /// Processes one item dequeued from the internal pending channel.
    /// Called sequentially by a single consumer loop.
    /// </summary>
    protected abstract Task ProcessAsync(TPending item, CancellationToken ct);

    // ── Protected helpers ─────────────────────────────────────────────────────

    /// <summary>The logger supplied at construction, available to subclasses.</summary>
    protected ILogger Logger { get; }

    /// <summary>
    /// <c>true</c> while the Postgres <c>LISTEN</c> connection is active.
    /// Subclasses expose this via their specific readiness-indicator interface.
    /// </summary>
    protected bool IsListening => _isListening;

    /// <summary>
    /// Called once after the LISTEN retry loop exits and the pending channel has been completed.
    /// Override in subclasses that own secondary channels (e.g. an ack delivery channel) to
    /// complete them so their consumers exit cleanly. Default is a no-op.
    /// </summary>
    protected virtual void OnListenLoopExited() { }

    // ── BackgroundService ─────────────────────────────────────────────────────

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var broadcastTask = ProcessLoopAsync(stoppingToken);
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
                Logger.LogError(ex, "{Broadcaster} lost Postgres connection; reconnecting in 5 s.", GetType().Name);
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }

        // Signal the process loop to drain and exit.
        _pending.Writer.TryComplete();
        OnListenLoopExited();
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var connectionString = _configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        conn.Notification += (_, args) =>
        {
            if (TryParseNotification(args.Payload, out var item))
                _pending.Writer.TryWrite(item);
        };

        await using (var cmd = new NpgsqlCommand($"LISTEN {PgChannelName}", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        _isListening = true;
        Logger.LogInformation("{Broadcaster}: LISTEN {Channel} active.", GetType().Name, PgChannelName);

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

    // ── Processing loop ───────────────────────────────────────────────────────

    private async Task ProcessLoopAsync(CancellationToken ct)
    {
        await foreach (var item in _pending.Reader.ReadAllAsync(ct))
        {
            try
            {
                await ProcessAsync(item, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "{Broadcaster}: error processing notification.", GetType().Name);
            }
        }
    }
}
