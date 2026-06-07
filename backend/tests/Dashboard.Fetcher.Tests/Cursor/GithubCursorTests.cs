using Dashboard.Fetcher.GitHub.Cursor;

namespace Dashboard.Fetcher.Tests.Cursor;

public sealed class GithubCursorTests
{
    // ── existing tests (repos section) ────────────────────────────────────────

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
    public void SinceFor_UnknownRepo_FallsBackToSuppliedNowMinusLookback()
    {
        var cursor = new GithubCursor();
        var lookback = TimeSpan.FromDays(7);
        var now = new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

        var since = cursor.SinceFor("new/repo", lookback, now);

        // Uses the caller-supplied clock, not wall-clock now (pinnable for tests/fixtures).
        Assert.Equal(now - lookback, since);
    }

    [Fact]
    public void SinceFor_KnownRepo_ReturnsStoredValue_IgnoringNow()
    {
        var stored = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var cursor = new GithubCursor().WithRepo("acme/api", stored);

        Assert.Equal(stored, cursor.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
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

    // ── backward-compatibility: old cursor without backfill key ──────────────

    [Fact]
    public void Decode_OldCursorWithoutBackfillKey_DecodesWithoutError()
    {
        // Encode a cursor that has no "backfill" JSON key (old shape).
        var since = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var old = new GithubCursor().WithRepo("acme/api", since);
        var encoded = old.Encode(); // produces {"repos":{...}} with no backfill key

        var decoded = GithubCursor.Decode(encoded);

        Assert.Equal(since, decoded.Repos["acme/api"].Since);
        Assert.Null(decoded.Backfill);
        Assert.False(decoded.IsBackfilling);
    }

    // ── backfill section round-trip ───────────────────────────────────────────

    [Fact]
    public void BackfillSection_RoundTripsThroughEncodeAndDecode()
    {
        var anchor = new DateTimeOffset(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithBackfillEnvDone("acme/api", anchor, "staging");

        var decoded = GithubCursor.Decode(cursor.Encode());

        var marker = decoded.BackfillFor("acme/api");
        Assert.NotNull(marker);
        Assert.Equal(anchor, marker!.Anchor);
        Assert.Contains("dev", marker.DoneEnvs);
        Assert.Contains("staging", marker.DoneEnvs);
    }

    // ── WithBackfillEnvDone appends without duplicates ────────────────────────

    [Fact]
    public void WithBackfillEnvDone_AppendsDoneEnv()
    {
        var anchor = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev");

        cursor = cursor.WithBackfillEnvDone("acme/api", anchor, "staging");

        var marker = cursor.BackfillFor("acme/api");
        Assert.NotNull(marker);
        Assert.Equal(2, marker!.DoneEnvs.Count);
        Assert.Contains("dev", marker.DoneEnvs);
        Assert.Contains("staging", marker.DoneEnvs);
    }

    [Fact]
    public void WithBackfillEnvDone_NoDuplicateEnvs()
    {
        var anchor = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithBackfillEnvDone("acme/api", anchor, "dev");

        var marker = cursor.BackfillFor("acme/api");
        Assert.NotNull(marker);
        Assert.Single(marker!.DoneEnvs);
    }

    [Fact]
    public void WithBackfillEnvDone_DoesNotMutateOriginal()
    {
        var anchor = DateTimeOffset.UtcNow;
        var original = new GithubCursor();
        _ = original.WithBackfillEnvDone("acme/api", anchor, "dev");

        Assert.Null(original.BackfillFor("acme/api"));
    }

    // ── WithBackfillComplete sets since and removes marker ────────────────────

    [Fact]
    public void WithBackfillComplete_SetsSinceAndRemovesMarker()
    {
        var anchor = DateTimeOffset.UtcNow;
        var since = anchor.AddHours(-2);
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithBackfillEnvDone("acme/api", anchor, "staging");

        cursor = cursor.WithBackfillComplete("acme/api", since);

        Assert.Equal(since, cursor.Repos["acme/api"].Since);
        Assert.Null(cursor.BackfillFor("acme/api"));
        Assert.False(cursor.IsBackfilling);
    }

    [Fact]
    public void WithBackfillComplete_NullMaxSince_DoesNotSetSince()
    {
        var anchor = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev");

        cursor = cursor.WithBackfillComplete("acme/api", null);

        // Repo entry not added when maxSince is null (empty-repo safe path).
        Assert.False(cursor.Repos.ContainsKey("acme/api"));
        Assert.Null(cursor.BackfillFor("acme/api"));
    }

    [Fact]
    public void WithBackfillComplete_OnlyRemovesTargetRepo_LeavesOthersIntact()
    {
        var anchor = DateTimeOffset.UtcNow;
        var since1 = anchor.AddHours(-1);
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithBackfillEnvDone("acme/web", anchor, "prod");

        cursor = cursor.WithBackfillComplete("acme/api", since1);

        // acme/api completed; acme/web still has a marker.
        Assert.Null(cursor.BackfillFor("acme/api"));
        Assert.NotNull(cursor.BackfillFor("acme/web"));
        Assert.True(cursor.IsBackfilling);
    }

    // ── IsBackfilling / BackfillRepos ─────────────────────────────────────────

    [Fact]
    public void IsBackfilling_FalseWhenNoMarkers()
    {
        var cursor = new GithubCursor().WithRepo("acme/api", DateTimeOffset.UtcNow);
        Assert.False(cursor.IsBackfilling);
    }

    [Fact]
    public void IsBackfilling_TrueWhenMarkerPresent()
    {
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", DateTimeOffset.UtcNow, "dev");
        Assert.True(cursor.IsBackfilling);
    }

    [Fact]
    public void BackfillRepos_ReturnsMarkedRepos()
    {
        var anchor = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithBackfillEnvDone("acme/web", anchor, "prod");

        var repos = cursor.BackfillRepos.ToHashSet();
        Assert.Contains("acme/api", repos);
        Assert.Contains("acme/web", repos);
    }

    // ── WithRepo preserves existing backfill section ──────────────────────────

    [Fact]
    public void WithRepo_PreservesExistingBackfillSection()
    {
        var anchor = DateTimeOffset.UtcNow;
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev");

        cursor = cursor.WithRepo("acme/web", anchor.AddHours(-1));

        // Backfill section must still be present after updating repos.
        Assert.NotNull(cursor.BackfillFor("acme/api"));
        Assert.Equal(anchor.AddHours(-1), cursor.Repos["acme/web"].Since);
    }
}
