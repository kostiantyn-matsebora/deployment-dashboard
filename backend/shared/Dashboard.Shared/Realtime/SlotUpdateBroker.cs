using System.Collections.Concurrent;
using System.Threading.Channels;
using Dashboard.Shared.Dto;

namespace Dashboard.Shared.Realtime;

/// <summary>
/// In-process fan-out of slot updates from <see cref="DeploymentListener"/>
/// to every connected SSE client on this Read API instance.
///
/// <para><strong>Statelessness:</strong> the broker only fans out to
/// clients of <em>this</em> instance. Multi-instance fan-out is handled by
/// PostgreSQL <c>LISTEN/NOTIFY</c> — every replica subscribes
/// independently. See SAD §7 "Statelessness constraints".</para>
///
/// <para>Each subscriber gets its own bounded channel with a small ring
/// buffer so a slow client cannot block the broker. The broker also
/// maintains a small global ring buffer for best-effort replay on
/// <c>Last-Event-ID</c> reconnect (SAD §7 Real-time path).</para>
/// </summary>
public sealed class SlotUpdateBroker
{
    private readonly ConcurrentDictionary<Guid, ChannelWriter<SlotUpdate>> _subscribers = new();
    private long _nextId;
    private readonly object _replayLock = new();
    private readonly SlotUpdate[] _replayBuffer;
    private int _replayHead;
    private int _replayCount;

    public SlotUpdateBroker(int replayBufferSize = 64)
    {
        if (replayBufferSize < 1) replayBufferSize = 1;
        _replayBuffer = new SlotUpdate[replayBufferSize];
    }

    /// <summary>Subscribe a new SSE client.</summary>
    /// <returns>
    /// A disposable subscription whose <see cref="Subscription.Reader"/>
    /// yields slot updates as they arrive. Disposing detaches the writer.
    /// </returns>
    public Subscription Subscribe()
    {
        var channel = Channel.CreateBounded<SlotUpdate>(new BoundedChannelOptions(capacity: 256)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        var id = Guid.NewGuid();
        _subscribers[id] = channel.Writer;
        return new Subscription(id, channel.Reader, this);
    }

    /// <summary>Push a slot payload from the LISTEN loop to all subscribers.</summary>
    internal void Publish(SlotUpdatePayload payload)
    {
        var update = new SlotUpdate(Interlocked.Increment(ref _nextId), payload);

        // Stash in the replay buffer first so reconnecting clients can pick
        // up missed events even if the broadcast below races them.
        lock (_replayLock)
        {
            _replayBuffer[_replayHead] = update;
            _replayHead = (_replayHead + 1) % _replayBuffer.Length;
            if (_replayCount < _replayBuffer.Length) _replayCount++;
        }

        foreach (var writer in _subscribers.Values)
        {
            // TryWrite cannot block because the channel is bounded; if it
            // fails we silently drop — the SSE client will see a gap and
            // can poll if it cares.
            writer.TryWrite(update);
        }
    }

    /// <summary>
    /// Return any buffered events with an id strictly greater than
    /// <paramref name="afterId"/>, ordered ascending. Used by the SSE
    /// endpoint to honour the browser-supplied <c>Last-Event-ID</c> on
    /// reconnect.
    /// </summary>
    public IReadOnlyList<SlotUpdate> ReplaySince(long afterId)
    {
        lock (_replayLock)
        {
            if (_replayCount == 0) return Array.Empty<SlotUpdate>();

            var result = new List<SlotUpdate>(_replayCount);
            for (var i = 0; i < _replayCount; i++)
            {
                var idx = (_replayHead - _replayCount + i + _replayBuffer.Length) % _replayBuffer.Length;
                var u = _replayBuffer[idx];
                if (u.Id > afterId) result.Add(u);
            }
            return result;
        }
    }

    private void Unsubscribe(Guid id)
    {
        if (_subscribers.TryRemove(id, out var writer))
        {
            writer.TryComplete();
        }
    }

    public sealed class Subscription : IDisposable
    {
        private readonly Guid _id;
        private readonly SlotUpdateBroker _owner;
        private int _disposed;

        public ChannelReader<SlotUpdate> Reader { get; }

        internal Subscription(Guid id, ChannelReader<SlotUpdate> reader, SlotUpdateBroker owner)
        {
            _id = id;
            Reader = reader;
            _owner = owner;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) == 0)
            {
                _owner.Unsubscribe(_id);
            }
        }
    }
}

/// <summary>
/// A single slot update as fanned out by the broker. The wire payload
/// (<see cref="Payload"/>) matches the SSE <c>slot-update</c> data shape in
/// SAD §7 — <c>{ service, environment, state }</c> where <c>state</c> is
/// the same per-slot object the REST endpoints return.
/// </summary>
public sealed record SlotUpdate(long Id, SlotUpdatePayload Payload);
