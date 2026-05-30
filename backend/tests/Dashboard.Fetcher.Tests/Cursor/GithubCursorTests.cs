using Dashboard.Fetcher.GitHub.Cursor;

namespace Dashboard.Fetcher.Tests.Cursor;

public sealed class GithubCursorTests
{
    [Fact]
    public void Decode_NullEncoded_ReturnsEmptyCursor()
    {
        var cursor = GithubCursor.Decode(null);
        Assert.Empty(cursor.Repos);
    }

    [Fact]
    public void EncodeAndDecode_RoundTrip_PreservesAllRepos()
    {
        var since = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var original = new GithubCursor().WithRepo("acme/api", since);

        var decoded = GithubCursor.Decode(original.Encode());

        Assert.Equal(since, decoded.Repos["acme/api"].Since);
    }

    [Fact]
    public void SinceFor_UnknownRepo_FallsBackToNowMinusLookback()
    {
        var cursor = new GithubCursor();
        var lookback = TimeSpan.FromDays(7);

        var since = cursor.SinceFor("new/repo", lookback);

        var expected = DateTimeOffset.UtcNow - lookback;
        Assert.True(Math.Abs((since - expected).TotalSeconds) < 2);
    }

    [Fact]
    public void SinceFor_KnownRepo_ReturnsStoredValue()
    {
        var stored = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var cursor = new GithubCursor().WithRepo("acme/api", stored);

        Assert.Equal(stored, cursor.SinceFor("acme/api", TimeSpan.FromDays(7)));
    }

    [Fact]
    public void WithRepo_DoesNotMutateOriginal()
    {
        var original = new GithubCursor();
        _ = original.WithRepo("acme/api", DateTimeOffset.UtcNow);

        Assert.Empty(original.Repos);
    }

    [Fact]
    public void WithRepo_AdvancesSpecificRepo()
    {
        var t1 = DateTimeOffset.UtcNow.AddHours(-1);
        var t2 = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithRepo("acme/api", t1)
            .WithRepo("acme/web", t2);

        Assert.Equal(t1, cursor.Repos["acme/api"].Since);
        Assert.Equal(t2, cursor.Repos["acme/web"].Since);
    }
}
