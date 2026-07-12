namespace Dashboard.Shared.Identifiers;

/// <summary>
/// Thread-safe generator of strictly monotonic UUIDv7 values.
///
/// <para>
/// The row <c>id</c> is a time-ordered UUIDv7 that doubles as the ordering key and SSE
/// resume cursor (API_SPECIFICATION D2/D3), resting on the stated invariant
/// "UUIDv7 is insert-time ordered". .NET's <see cref="Guid.CreateVersion7()"/> encodes only
/// a millisecond timestamp in its high bits and fills the remainder with <em>random</em> data —
/// it keeps no intra-millisecond counter — so two ids minted within the same millisecond have a
/// <em>random</em> relative order. That breaks the per-slot "latest wins" tiebreak
/// (<c>OrderByDescending(id)</c>) and <c>WHERE id &gt; @last ORDER BY id</c> resume (issue #330).
/// </para>
///
/// <para>
/// This generator guarantees every returned value is strictly greater than the previous one —
/// both under .NET <see cref="Guid"/> comparison and under big-endian byte / Postgres <c>uuid</c>
/// comparison, which agree for v7-shaped ids. When the wall clock has not advanced past the last
/// issued value it increments that value by one (preserving the version and variant nibbles)
/// instead of re-rolling random bits. Monotonicity is guaranteed per process; across processes
/// ids stay time-ordered to the millisecond exactly as before.
/// </para>
/// </summary>
public static class MonotonicGuid
{
    private static readonly object Gate = new();

    // Big-endian bytes of the last issued value. All-zero sorts below any real v7 id.
    private static byte[] _last = new byte[16];

    /// <summary>
    /// Returns a UUIDv7 strictly greater than every value previously returned by this generator.
    /// </summary>
    public static Guid CreateVersion7()
    {
        lock (Gate)
        {
            var candidate = Guid.CreateVersion7().ToByteArray(bigEndian: true);

            // Same or earlier millisecond as the last issued id → the random low bits may sort
            // below it. Fall back to last + 1 so ordering is strictly monotonic.
            if (CompareBigEndian(candidate, _last) <= 0)
            {
                candidate = (byte[])_last.Clone();
                IncrementBigEndian(candidate);
            }

            _last = candidate;
            return new Guid(candidate, bigEndian: true);
        }
    }

    private static int CompareBigEndian(byte[] a, byte[] b)
    {
        for (var i = 0; i < 16; i++)
        {
            var d = a[i].CompareTo(b[i]);
            if (d != 0) return d;
        }

        return 0;
    }

    // Adds 1 to a 16-byte big-endian integer in place, carrying from the least significant byte
    // upward. Reaching the version/variant nibbles would take 2^62 increments in one millisecond,
    // so in practice only the random low bits move.
    private static void IncrementBigEndian(byte[] value)
    {
        for (var i = value.Length - 1; i >= 0; i--)
        {
            if (++value[i] != 0) return; // no carry out of this byte
        }
    }
}
