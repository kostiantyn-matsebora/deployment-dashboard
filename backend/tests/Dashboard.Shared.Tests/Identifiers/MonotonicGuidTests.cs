using Dashboard.Shared.Identifiers;

namespace Dashboard.Shared.Tests.Identifiers;

/// <summary>
/// Unit tests for <see cref="MonotonicGuid"/>. No mocks — exercises the real generator.
/// </summary>
public sealed class MonotonicGuidTests
{
    // ── Shape ─────────────────────────────────────────────────────────────────

    [Fact]
    public void CreateVersion7_VersionNibbleIsSeven()
    {
        var bytes = MonotonicGuid.CreateVersion7().ToByteArray(bigEndian: true);
        Assert.Equal(0x70, bytes[6] & 0xF0);
    }

    [Fact]
    public void CreateVersion7_VariantBitsAreRfc4122()
    {
        var bytes = MonotonicGuid.CreateVersion7().ToByteArray(bigEndian: true);
        Assert.Equal(0x80, bytes[8] & 0xC0);
    }

    // ── Monotonicity (the core regression for issue #330) ───────────────────

    [Fact]
    public void CreateVersion7_TightLoop_StrictlyIncreasingUnderGuidComparison()
    {
        const int iterations = 200_000;
        var previous = default(Guid);
        var inversions = 0;

        for (var i = 0; i < iterations; i++)
        {
            var current = MonotonicGuid.CreateVersion7();
            if (i > 0 && current.CompareTo(previous) <= 0)
                inversions++;
            previous = current;
        }

        Assert.Equal(0, inversions);
    }

    [Fact]
    public void CreateVersion7_TightLoop_StrictlyIncreasingUnderBigEndianByteComparison()
    {
        const int iterations = 200_000;
        byte[]? previous = null;
        var inversions = 0;

        for (var i = 0; i < iterations; i++)
        {
            var current = MonotonicGuid.CreateVersion7().ToByteArray(bigEndian: true);
            if (previous is not null && CompareBigEndian(current, previous) <= 0)
                inversions++;
            previous = current;
        }

        Assert.Equal(0, inversions);
    }

    // ── Concurrency ───────────────────────────────────────────────────────────

    [Fact]
    public void CreateVersion7_ConcurrentThreads_AllValuesDistinct()
    {
        const int threadCount = 8;
        const int perThread = 5_000;
        var results = new Guid[threadCount][];

        Parallel.For(0, threadCount, t =>
        {
            var local = new Guid[perThread];
            for (var i = 0; i < perThread; i++)
                local[i] = MonotonicGuid.CreateVersion7();
            results[t] = local;
        });

        var all = results.SelectMany(g => g).ToArray();
        var distinct = new HashSet<Guid>(all);

        Assert.Equal(threadCount * perThread, all.Length);
        Assert.Equal(all.Length, distinct.Count);
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
}
