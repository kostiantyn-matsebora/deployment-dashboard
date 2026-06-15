namespace Dashboard.Fetcher.GitHub.Graph;

/// <summary>Thread-safe bounded LRU cache.</summary>
internal sealed class BoundedLruCache<TKey, TValue>(int maxSize) where TKey : notnull
{
    private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _lookup = new();
    private readonly LinkedList<(TKey Key, TValue Value)> _order = new();
    private readonly Lock _lock = new();

    public bool TryGet(TKey key, out TValue? value)
    {
        lock (_lock)
        {
            if (!_lookup.TryGetValue(key, out var node))
            {
                value = default;
                return false;
            }
            _order.Remove(node);
            _order.AddFirst(node);
            value = node.Value.Value;
            return true;
        }
    }

    public void Set(TKey key, TValue value)
    {
        lock (_lock)
        {
            if (_lookup.TryGetValue(key, out var existing))
            {
                _order.Remove(existing);
                _lookup.Remove(key);
            }
            var node = _order.AddFirst((key, value));
            _lookup[key] = node;

            while (_order.Count > maxSize && _order.Last is not null)
            {
                var lru = _order.Last;
                _order.RemoveLast();
                _lookup.Remove(lru.Value.Key);
            }
        }
    }

    /// <summary>Drops all entries — used to reset fetch state on the reset saga (§5.10.5).</summary>
    public void Clear()
    {
        lock (_lock)
        {
            _lookup.Clear();
            _order.Clear();
        }
    }
}
