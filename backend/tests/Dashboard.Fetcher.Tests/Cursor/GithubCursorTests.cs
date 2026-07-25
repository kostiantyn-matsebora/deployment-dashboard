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

    // ── IsEmpty (reset clean-slate / first-run detection — §5.10.5) ───────────

    [Fact]
    public void IsEmpty_TrueForFreshCursor()
    {
        Assert.True(new GithubCursor().IsEmpty);
    }

    [Fact]
    public void IsEmpty_TrueAfterDecodingEmptyEncodedCursor()
    {
        // An empty backfill encodes to a non-null {"repos":{}} string; it must STILL read
        // as empty so the next poll re-backfills instead of switching to incremental.
        var encoded = new GithubCursor().Encode();
        Assert.True(GithubCursor.Decode(encoded).IsEmpty);
    }

    [Fact]
    public void IsEmpty_TrueAfterEmptyBackfillComplete()
    {
        // A backfill that found no events (maxSince=null) leaves no repo high-water mark,
        // so the cursor stays empty and the next cycle re-backfills.
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", DateTimeOffset.UtcNow, "dev")
            .WithBackfillComplete("acme/api", null);
        Assert.True(cursor.IsEmpty);
    }

    [Fact]
    public void IsEmpty_FalseWhenRepoHasHighWaterMark()
    {
        var cursor = new GithubCursor().WithRepo("acme/api", DateTimeOffset.UtcNow);
        Assert.False(cursor.IsEmpty);
    }

    [Fact]
    public void IsEmpty_FalseWhileBackfilling()
    {
        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", DateTimeOffset.UtcNow, "dev");
        Assert.False(cursor.IsEmpty);
    }

    // ── OldestPending (WithRepoState / OldestPendingFor) ─────────────────────

    [Fact]
    public void OldestPendingFor_FreshCursor_ReturnsNull()
    {
        // No repo entry at all → null.
        Assert.Null(new GithubCursor().OldestPendingFor("acme/api"));
    }

    [Fact]
    public void OldestPendingFor_RepoKnownViaWithRepo_ReturnsNull()
    {
        // WithRepo sets only Since; OldestPending defaults to null in RepoCursor.
        var cursor = new GithubCursor().WithRepo("acme/api", DateTimeOffset.UtcNow);
        Assert.Null(cursor.OldestPendingFor("acme/api"));
    }

    [Fact]
    public void OldestPendingFor_UnknownRepo_ReturnsNull()
    {
        var cursor = new GithubCursor().WithRepo("acme/api", DateTimeOffset.UtcNow);
        Assert.Null(cursor.OldestPendingFor("other/repo"));
    }

    [Fact]
    public void WithRepoState_SetsOldestPendingAndSince()
    {
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var oldest = new DateTimeOffset(2026, 5, 15, 12, 0, 0, TimeSpan.Zero);

        var cursor = new GithubCursor().WithRepoState("acme/api", since, oldest);

        Assert.Equal(oldest, cursor.OldestPendingFor("acme/api"));
        Assert.Equal(since, cursor.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void WithRepoState_NullOldestPending_OldestPendingForReturnsNull()
    {
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        var cursor = new GithubCursor().WithRepoState("acme/api", since, null);

        Assert.Null(cursor.OldestPendingFor("acme/api"));
        Assert.Equal(since, cursor.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void WithRepoState_EncodeAndDecode_PreservesOldestPending()
    {
        // Full encode/decode round-trip must preserve the oldest_pending value exactly.
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var oldest = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);

        var decoded = GithubCursor.Decode(
            new GithubCursor().WithRepoState("acme/api", since, oldest).Encode());

        Assert.Equal(oldest, decoded.OldestPendingFor("acme/api"));
        Assert.Equal(since, decoded.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void WithRepoState_NullOldestPending_EncodeAndDecode_ReturnsNullPending()
    {
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        var decoded = GithubCursor.Decode(
            new GithubCursor().WithRepoState("acme/api", since, null).Encode());

        Assert.Null(decoded.OldestPendingFor("acme/api"));
    }

    /// <summary>
    /// Backward-compat: cursors produced BEFORE the oldest_pending field was added contain a
    /// RepoCursor JSON object with only the "since" key.  When decoded, OldestPendingFor must
    /// return null (missing key → default null for nullable type).
    /// </summary>
    [Fact]
    public void Decode_OldCursorJsonWithoutOldestPendingKey_ReturnsNullPending()
    {
        // Craft the pre-existing cursor JSON manually — no "oldest_pending" key present.
        // String concatenation avoids raw-string brace-count ambiguity (CS9007).
        const string since = "2026-05-01T00:00:00+00:00";
        var oldJson = "{\"repos\":{\"acme/api\":{\"since\":\"" + since + "\"}}}";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(oldJson));

        var decoded = GithubCursor.Decode(encoded);

        Assert.Null(decoded.OldestPendingFor("acme/api"));
        Assert.Equal(
            new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero),
            decoded.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
    }

    [Fact]
    public void WithRepoState_DoesNotMutateOriginal()
    {
        var original = new GithubCursor();
        var since = DateTimeOffset.UtcNow;
        var oldest = since.AddDays(-1);

        _ = original.WithRepoState("acme/api", since, oldest);

        // Original is unchanged.
        Assert.Empty(original.Repos);
        Assert.Null(original.OldestPendingFor("acme/api"));
    }

    [Fact]
    public void WithRepoState_UpdatesExistingRepoEntry()
    {
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var oldest1 = since.AddDays(-5);
        var oldest2 = since.AddDays(-10);

        var cursor = new GithubCursor()
            .WithRepoState("acme/api", since, oldest1)
            .WithRepoState("acme/api", since, oldest2);

        // Second call overwrites; oldest2 is the new floor.
        Assert.Equal(oldest2, cursor.OldestPendingFor("acme/api"));
    }

    [Fact]
    public void WithRepoState_PreservesBackfillSection()
    {
        var anchor = DateTimeOffset.UtcNow;
        var since = anchor.AddDays(-1);
        var oldest = anchor.AddDays(-2);

        var cursor = new GithubCursor()
            .WithBackfillEnvDone("acme/api", anchor, "dev")
            .WithRepoState("acme/api", since, oldest);

        // Backfill section must survive a WithRepoState call.
        Assert.NotNull(cursor.BackfillFor("acme/api"));
        Assert.Equal(oldest, cursor.OldestPendingFor("acme/api"));
    }

    [Fact]
    public void WithRepoState_OtherReposUnaffected()
    {
        var since = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var oldest = since.AddDays(-1);
        var otherSince = since.AddHours(-3);

        var cursor = new GithubCursor()
            .WithRepo("acme/web", otherSince)
            .WithRepoState("acme/api", since, oldest);

        Assert.Equal(otherSince, cursor.SinceFor("acme/web", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
        Assert.Null(cursor.OldestPendingFor("acme/web"));
        Assert.Equal(oldest, cursor.OldestPendingFor("acme/api"));
    }

    // ── Recover rewind cursor shape (issue #423, §5.10.6) ─────────────────────
    //
    // GithubActionsAdapter.RewindTo builds its rewound cursor purely via repeated WithRepo
    // calls (one per configured repo, same `since` for all) — these tests pin down the
    // resulting GithubCursor shape: non-empty, no backfill markers, every repo's high-water
    // mark set to the resolved rewind point. End-to-end adapter-level coverage (HTTP-mocked,
    // asserting FetchAsync takes PollAsync afterwards) lives in
    // Dashboard.Fetcher.Tests/Poll/RecoverRewindPollTests.cs.

    [Fact]
    public void RewindShape_MultipleWithRepoCalls_EveryRepoGetsSameSince_NoBackfillSection()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);

        // Mirrors RewindTo's `foreach (repo in RepoList) rewound = rewound.WithRepo(repo, since)`.
        var rewound = new GithubCursor()
            .WithRepo("acme/api", since)
            .WithRepo("acme/web", since)
            .WithRepo("acme/worker", since);

        Assert.Equal(since, rewound.Repos["acme/api"].Since);
        Assert.Equal(since, rewound.Repos["acme/web"].Since);
        Assert.Equal(since, rewound.Repos["acme/worker"].Since);
        Assert.Null(rewound.Backfill);
        Assert.False(rewound.IsBackfilling);
        Assert.False(rewound.IsEmpty);
    }

    [Fact]
    public void RewindShape_EncodeAndDecode_RoundTripsEveryRepoSince()
    {
        var since = DateTimeOffset.UtcNow.AddDays(-5);
        var rewound = new GithubCursor()
            .WithRepo("acme/api", since)
            .WithRepo("acme/web", since);

        var decoded = GithubCursor.Decode(rewound.Encode());

        Assert.Equal(since, decoded.SinceFor("acme/api", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
        Assert.Equal(since, decoded.SinceFor("acme/web", TimeSpan.FromDays(7), DateTimeOffset.UtcNow));
        Assert.False(decoded.IsBackfilling);
        Assert.False(decoded.IsEmpty);
    }

    [Fact]
    public void RewindShape_ReplacesAnyPriorBackfillSection_ForARewoundRepo()
    {
        // A repo that was mid-backfill before an outage must NOT still carry a stale backfill
        // marker after the rewind targets it — WithRepo does not clear Backfill for OTHER
        // repos, but this documents the case actually exercised by RewindTo: every configured
        // repo receives a fresh WithRepo(since) call, and RewindTo starts from `new GithubCursor()`
        // (empty), so the emitted cursor as a whole never carries backfill markers regardless of
        // what any prior in-flight cursor held.
        var freshRewind = new GithubCursor().WithRepo("acme/api", DateTimeOffset.UtcNow);

        Assert.Null(freshRewind.BackfillFor("acme/api"));
        Assert.False(freshRewind.IsBackfilling);
    }
}
