using System.Collections.Concurrent;
using System.Threading.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Sse;

/// <summary>
/// Extends <see cref="PgListenBroadcasterBase{TPending}"/> with a subscriber fan-out layer.
/// </summary>
/// <remarks>
/// Concrete subclasses provide <see cref="ResolveAsync"/> to convert a pending item into
/// the published payload, plus the inherited <see cref="PgListenBroadcasterBase{TPending}.PgChannelName"/>
/// and <see cref="PgListenBroadcasterBase{TPending}.TryParseNotification"/> members.
/// The subscription management (<see cref="Subscribe"/>, <see cref="Unsubscribe"/>,
/// <see cref="Publish"/>) is fully implemented here.
/// </remarks>
/// <typeparam name="TPending">
/// The type dequeued from the LISTEN callback (e.g. <see cref="Guid"/> or <see cref="string"/>).
/// </typeparam>
/// <typeparam name="TPayload">The type written to subscriber channels.</typeparam>
public abstract class PgListenFanOutBase<TPending, TPayload> : PgListenBroadcasterBase<TPending>
{
    // Active subscriber channels keyed by their reader (the handle callers retain).
    private readonly ConcurrentDictionary<ChannelReader<TPayload>, ChannelWriter<TPayload>>
        _subscriptions = new();

    /// <inheritdoc cref="PgListenBroadcasterBase{TPending}(Microsoft.Extensions.Configuration.IConfiguration,Microsoft.Extensions.Logging.ILogger)"/>
    protected PgListenFanOutBase(
        IConfiguration configuration,
        ILogger logger)
        : base(configuration, logger) { }

    // ── Subclass contract ─────────────────────────────────────────────────────

    /// <summary>
    /// Resolves the pending notification item into the payload to publish.
    /// Return <c>null</c> to skip the item (e.g. entity not found).
    /// </summary>
    protected abstract Task<TPayload?> ResolveAsync(TPending item, CancellationToken ct);

    // ── Subscription API (consumed by endpoints/services via the broadcaster interfaces) ──

    /// <summary>
    /// Registers a new subscriber and returns the reader end of a dedicated bounded channel.
    /// The caller MUST call <see cref="Unsubscribe"/> when the SSE connection closes.
    /// </summary>
    public ChannelReader<TPayload> Subscribe()
    {
        var ch = Channel.CreateBounded<TPayload>(
            new BoundedChannelOptions(capacity: 256)
            {
                FullMode = BoundedChannelFullMode.DropOldest,
                SingleReader = true,
                SingleWriter = false,
            });

        _subscriptions[ch.Reader] = ch.Writer;
        return ch.Reader;
    }

    /// <summary>Deregisters the subscriber and completes its channel so the reader exits cleanly.</summary>
    public void Unsubscribe(ChannelReader<TPayload> reader)
    {
        if (_subscriptions.TryRemove(reader, out var writer))
            writer.TryComplete();
    }

    /// <summary>Writes <paramref name="payload"/> to every active subscriber channel.</summary>
    protected void Publish(TPayload payload)
    {
        foreach (var (_, writer) in _subscriptions)
            writer.TryWrite(payload);
    }

    // ── PgListenBroadcasterBase<TPending> ─────────────────────────────────────

    /// <inheritdoc />
    protected override async Task ProcessAsync(TPending item, CancellationToken ct)
    {
        var payload = await ResolveAsync(item, ct);
        if (payload is not null)
            Publish(payload);
    }
}
