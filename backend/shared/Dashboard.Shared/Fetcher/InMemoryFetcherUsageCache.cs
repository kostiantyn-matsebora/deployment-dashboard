using System.Collections.Concurrent;

namespace Dashboard.Shared.Fetcher;

/// <summary>
/// Default <see cref="IFetcherUsageCache"/> implementation — process-local
/// <see cref="ConcurrentDictionary{TKey, TValue}"/> keyed by
/// <c>(adapter_id, source_id)</c> with ordinal case-sensitive comparison
/// (CR-0011 § 3c). Singleton lifetime in DI; both the API host
/// composition root and the standalone fetcher host register exactly one
/// instance so the Write + Read endpoint groups see the same store.
///
/// <para>The <see cref="TimeProvider"/> dependency lets tests stamp
/// deterministic <c>received_at</c> values without coupling to wall-clock
/// drift; production uses <see cref="TimeProvider.System"/>.</para>
/// </summary>
public sealed class InMemoryFetcherUsageCache : IFetcherUsageCache
{
    private readonly TimeProvider _timeProvider;

    private readonly ConcurrentDictionary<(string AdapterId, string SourceId), FetcherUsageSnapshotResponse> _store
        = new(new OrdinalCaseSensitiveKeyComparer());

    public InMemoryFetcherUsageCache() : this(TimeProvider.System) { }

    public InMemoryFetcherUsageCache(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    public FetcherUsageSnapshotResponse Upsert(FetcherUsageSnapshotRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The Write handler performs the presence check on
        // UpstreamResetAt / ObservedAt (DateTime?) BEFORE calling Upsert,
        // so reaching this line with null is a programming error. Throw
        // loud rather than persist a degenerate 0001-01-01 default.
        if (request.UpstreamResetAt is null)
        {
            throw new ArgumentException(
                $"{nameof(FetcherUsageSnapshotRequest)}.{nameof(FetcherUsageSnapshotRequest.UpstreamResetAt)} must be non-null before Upsert (presence check belongs to the handler).",
                nameof(request));
        }
        if (request.ObservedAt is null)
        {
            throw new ArgumentException(
                $"{nameof(FetcherUsageSnapshotRequest)}.{nameof(FetcherUsageSnapshotRequest.ObservedAt)} must be non-null before Upsert (presence check belongs to the handler).",
                nameof(request));
        }

        var snapshot = new FetcherUsageSnapshotResponse
        {
            AdapterId = request.AdapterId,
            SourceId = request.SourceId,
            UpstreamLimit = request.UpstreamLimit,
            UpstreamRemaining = request.UpstreamRemaining,
            UpstreamResetAt = ToUtc(request.UpstreamResetAt.Value),
            SelfImposedCap = request.SelfImposedCap,
            UpstreamUsed = request.UpstreamUsed,
            ObservedAt = ToUtc(request.ObservedAt.Value),
            ReceivedAt = _timeProvider.GetUtcNow().UtcDateTime,
        };

        _store[(request.AdapterId, request.SourceId)] = snapshot;
        return snapshot;
    }

    public IReadOnlyList<FetcherUsageSnapshotResponse> GetAll()
    {
        // Snapshot the values via ToArray() so the caller iterates over a
        // stable list, not a live view of the concurrent dictionary.
        return _store.Values.ToArray();
    }

    private static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Unspecified => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        _ => value.ToUniversalTime(),
    };

    /// <summary>
    /// Ordinal case-sensitive tuple equality — both halves of the key are
    /// case-sensitive on the wire (GHA repo paths + adapter identifiers).
    /// <see cref="StringComparer.Ordinal"/> on the strings; structural
    /// hash for the tuple.
    /// </summary>
    private sealed class OrdinalCaseSensitiveKeyComparer
        : IEqualityComparer<(string AdapterId, string SourceId)>
    {
        public bool Equals((string AdapterId, string SourceId) x, (string AdapterId, string SourceId) y)
            => string.Equals(x.AdapterId, y.AdapterId, StringComparison.Ordinal)
            && string.Equals(x.SourceId, y.SourceId, StringComparison.Ordinal);

        public int GetHashCode((string AdapterId, string SourceId) obj)
            => HashCode.Combine(
                StringComparer.Ordinal.GetHashCode(obj.AdapterId),
                StringComparer.Ordinal.GetHashCode(obj.SourceId));
    }
}
