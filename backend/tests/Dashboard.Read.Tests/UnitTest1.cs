using System.Text;
using Dashboard.Read.Cursors;

namespace Dashboard.Read.Tests;

public sealed class CursorCodecTests
{
    [Fact]
    public void Encode_ProducesBase64UrlSafeString()
    {
        var cursor = CursorCodec.Encode(DateTimeOffset.UtcNow, Guid.NewGuid());

        Assert.DoesNotContain('+', cursor);
        Assert.DoesNotContain('/', cursor);
        Assert.DoesNotContain('=', cursor);
    }

    [Fact]
    public void TryDecode_RoundTrip_RecovershappenedAtAndId()
    {
        var happenedAt = new DateTimeOffset(2026, 5, 28, 10, 14, 2, TimeSpan.Zero);
        var id = Guid.CreateVersion7();

        var encoded = CursorCodec.Encode(happenedAt, id);
        var success = CursorCodec.TryDecode(encoded, out var decoded);

        Assert.True(success);
        Assert.NotNull(decoded);
        Assert.Equal(happenedAt, decoded.HappenedAt);
        Assert.Equal(id, decoded.Id);
    }

    [Fact]
    public void TryDecode_EmptyString_ReturnsFalse()
    {
        var success = CursorCodec.TryDecode("", out var decoded);

        Assert.False(success);
        Assert.Null(decoded);
    }

    [Fact]
    public void TryDecode_InvalidBase64_ReturnsFalse()
    {
        var success = CursorCodec.TryDecode("!!!not-valid!!!", out var decoded);

        Assert.False(success);
        Assert.Null(decoded);
    }

    [Fact]
    public void TryDecode_ValidBase64ButMissingHField_ReturnsFalse()
    {
        // JSON with only "i" — missing "h"
        var json = $"{{\"i\":\"{Guid.NewGuid()}\"}}";
        var cursor = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var success = CursorCodec.TryDecode(cursor, out var decoded);

        Assert.False(success);
        Assert.Null(decoded);
    }

    [Fact]
    public void TryDecode_InvalidDateInHField_ReturnsFalse()
    {
        var json = $"{{\"h\":\"not-a-date\",\"i\":\"{Guid.NewGuid()}\"}}";
        var cursor = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var success = CursorCodec.TryDecode(cursor, out var decoded);

        Assert.False(success);
        Assert.Null(decoded);
    }

    [Fact]
    public void TryDecode_InvalidGuidInIField_ReturnsFalse()
    {
        var json = "{\"h\":\"2026-05-28T10:14:02Z\",\"i\":\"not-a-guid\"}";
        var cursor = Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');

        var success = CursorCodec.TryDecode(cursor, out var decoded);

        Assert.False(success);
        Assert.Null(decoded);
    }

    [Fact]
    public void TryDecode_DifferentTimezoneOffsets_PreservesOffset()
    {
        var happenedAt = new DateTimeOffset(2026, 5, 28, 12, 0, 0, TimeSpan.FromHours(2));
        var id = Guid.CreateVersion7();

        var encoded = CursorCodec.Encode(happenedAt, id);
        CursorCodec.TryDecode(encoded, out var decoded);

        // DateTimeOffset.TryParse normalises to the original offset; compare as UTC instants.
        Assert.Equal(happenedAt.ToUniversalTime(), decoded!.HappenedAt.ToUniversalTime());
    }
}
