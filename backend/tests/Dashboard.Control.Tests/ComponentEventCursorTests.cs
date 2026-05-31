using Dashboard.Control.Cursors;

namespace Dashboard.Control.Tests;

/// <summary>Unit tests for the component-event pagination cursor codec.</summary>
public sealed class ComponentEventCursorTests
{
    [Fact]
    public void EncodeThenDecode_RoundTripsValues()
    {
        var receivedAt = new DateTimeOffset(2026, 5, 31, 10, 0, 0, TimeSpan.Zero);
        var id = Guid.CreateVersion7();

        var cursor = ComponentEventCursor.Encode(receivedAt, id);
        var ok = ComponentEventCursor.TryDecode(cursor, out var decoded);

        Assert.True(ok);
        Assert.Equal(receivedAt, decoded!.ReceivedAt);
        Assert.Equal(id, decoded.Id);
    }

    [Fact]
    public void Encode_ProducesUrlSafeToken()
    {
        var cursor = ComponentEventCursor.Encode(DateTimeOffset.UtcNow, Guid.CreateVersion7());

        Assert.DoesNotContain('+', cursor);
        Assert.DoesNotContain('/', cursor);
        Assert.DoesNotContain('=', cursor);
    }

    [Theory]
    [InlineData("not-base64-!!!")]
    [InlineData("")]
    [InlineData("eyJ4IjoxfQ")] // valid base64url JSON but missing r/i fields
    public void TryDecode_RejectsMalformedCursor(string cursor)
    {
        var ok = ComponentEventCursor.TryDecode(cursor, out var decoded);

        Assert.False(ok);
        Assert.Null(decoded);
    }
}
