using Dashboard.Fetcher.Orchestration;
using NSubstitute;

namespace Dashboard.Fetcher.Tests.Orchestration;

/// <summary>
/// Unit tests for <see cref="FetcherReadinessIndicator"/> state transitions.
/// Covers: ok→auth_failed→ok; paused-for-reset ≠ failed; all outcome transitions.
/// </summary>
public sealed class FetcherReadinessIndicatorTests
{
    // ── Initial state ────────────────────────────────────────────────────────

    [Fact]
    public void InitialState_AllNullAndNotPaused()
    {
        var indicator = new FetcherReadinessIndicator();

        Assert.Null(indicator.LastOutcome);
        Assert.Null(indicator.LastSuccessAt);
        Assert.Null(indicator.LastErrorSummary);
        Assert.False(indicator.IsPausedForReset);
        Assert.Null(indicator.RateLimit);
    }

    // ── RecordSuccess ────────────────────────────────────────────────────────

    [Fact]
    public void RecordSuccess_SetsOkOutcomeAndTimestamp()
    {
        var indicator = new FetcherReadinessIndicator();
        var before = DateTimeOffset.UtcNow;

        indicator.RecordSuccess();

        Assert.Equal(PollOutcome.Ok, indicator.LastOutcome);
        Assert.NotNull(indicator.LastSuccessAt);
        Assert.True(indicator.LastSuccessAt >= before);
        Assert.Null(indicator.LastErrorSummary);
    }

    [Fact]
    public void RecordSuccess_WithRateLimitSnapshot_StoresSnapshot()
    {
        var indicator = new FetcherReadinessIndicator();
        var snapshot = new RateLimitSnapshot(Used: 150, Budget: 1500, ResetAt: DateTimeOffset.UtcNow.AddHours(1));

        indicator.RecordSuccess(snapshot);

        Assert.Equal(PollOutcome.Ok, indicator.LastOutcome);
        Assert.NotNull(indicator.RateLimit);
        Assert.Equal(150, indicator.RateLimit!.Used);
        Assert.Equal(1500, indicator.RateLimit.Budget);
    }

    [Fact]
    public void RecordSuccess_WithoutSnapshot_DoesNotClearExistingSnapshot()
    {
        var indicator = new FetcherReadinessIndicator();
        var snapshot = new RateLimitSnapshot(Used: 100, Budget: 1000, ResetAt: DateTimeOffset.UtcNow.AddHours(1));
        indicator.RecordSuccess(snapshot);

        // Second success without snapshot should keep the previous snapshot.
        indicator.RecordSuccess(null);

        Assert.NotNull(indicator.RateLimit);
        Assert.Equal(100, indicator.RateLimit!.Used);
    }

    // ── RecordAuthFailed ─────────────────────────────────────────────────────

    [Fact]
    public void RecordAuthFailed_SetsAuthFailedOutcomeAndSummary()
    {
        var indicator = new FetcherReadinessIndicator();
        indicator.RecordAuthFailed("401 Unauthorized");

        Assert.Equal(PollOutcome.AuthFailed, indicator.LastOutcome);
        Assert.Equal("401 Unauthorized", indicator.LastErrorSummary);
    }

    // ── ok → auth_failed → ok transition ────────────────────────────────────

    [Fact]
    public void Transition_OkToAuthFailedToOk_StateFollowsLatestRecord()
    {
        var indicator = new FetcherReadinessIndicator();

        indicator.RecordSuccess();
        Assert.Equal(PollOutcome.Ok, indicator.LastOutcome);
        Assert.Null(indicator.LastErrorSummary);

        indicator.RecordAuthFailed("401 Unauthorized");
        Assert.Equal(PollOutcome.AuthFailed, indicator.LastOutcome);
        Assert.NotNull(indicator.LastErrorSummary);

        indicator.RecordSuccess();
        Assert.Equal(PollOutcome.Ok, indicator.LastOutcome);
        // Error summary cleared on success.
        Assert.Null(indicator.LastErrorSummary);
    }

    // ── RecordRateLimited ────────────────────────────────────────────────────

    [Fact]
    public void RecordRateLimited_SetsRateLimitedOutcomeAndSnapshot()
    {
        var indicator = new FetcherReadinessIndicator();
        var resetAt = DateTimeOffset.UtcNow.AddHours(1);
        var snapshot = new RateLimitSnapshot(Used: 5000, Budget: 1500, ResetAt: resetAt);

        indicator.RecordRateLimited(snapshot);

        Assert.Equal(PollOutcome.RateLimited, indicator.LastOutcome);
        Assert.NotNull(indicator.LastErrorSummary);
        Assert.NotNull(indicator.RateLimit);
        Assert.Equal(5000, indicator.RateLimit!.Used);
    }

    // ── RecordError ──────────────────────────────────────────────────────────

    [Fact]
    public void RecordError_SetsErrorOutcomeAndSummary()
    {
        var indicator = new FetcherReadinessIndicator();
        indicator.RecordError("Network timeout");

        Assert.Equal(PollOutcome.Error, indicator.LastOutcome);
        Assert.Equal("Network timeout", indicator.LastErrorSummary);
    }

    // ── Paused-for-reset is NOT a failure ─────────────────────────────────────

    [Fact]
    public void PausedForReset_DoesNotChangeOutcome_IsIndependentFlag()
    {
        var indicator = new FetcherReadinessIndicator();
        indicator.RecordSuccess();

        indicator.SetPausedForReset(true);

        // Paused is a separate flag — outcome stays ok.
        Assert.True(indicator.IsPausedForReset);
        Assert.Equal(PollOutcome.Ok, indicator.LastOutcome);
        Assert.Null(indicator.LastErrorSummary);
    }

    [Fact]
    public void PausedForReset_ThenResumed_FlagClears()
    {
        var indicator = new FetcherReadinessIndicator();

        indicator.SetPausedForReset(true);
        Assert.True(indicator.IsPausedForReset);

        indicator.SetPausedForReset(false);
        Assert.False(indicator.IsPausedForReset);
    }

    [Fact]
    public void PausedForReset_WhileAuthFailed_PausedFlagIndependentOfOutcome()
    {
        // A paused loop that had a prior auth failure must not confuse the readyz handler.
        // The handler decision uses BOTH paused flag AND outcome — this test confirms they
        // are orthogonal so the handler can apply its own logic.
        var indicator = new FetcherReadinessIndicator();
        indicator.RecordAuthFailed("403 Forbidden");

        indicator.SetPausedForReset(true);

        Assert.True(indicator.IsPausedForReset);
        Assert.Equal(PollOutcome.AuthFailed, indicator.LastOutcome);
    }

    // ── PollLoop integration: Pause/Resume updates indicator ─────────────────

    [Fact]
    public void PollLoop_Pause_UpdatesReadinessIndicator()
    {
        var indicator = new FetcherReadinessIndicator();
        var loop = MakePollLoop(indicator);

        loop.Pause();

        Assert.True(indicator.IsPausedForReset);
    }

    [Fact]
    public void PollLoop_DropCursorAndResume_ClearsPausedFlag()
    {
        var indicator = new FetcherReadinessIndicator();
        var loop = MakePollLoop(indicator);

        loop.Pause();
        Assert.True(indicator.IsPausedForReset);

        loop.DropCursorAndResume();
        Assert.False(indicator.IsPausedForReset);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static async IAsyncEnumerable<Dashboard.Fetcher.Abstractions.FetchResult> EmptyChunks()
    {
        yield return new Dashboard.Fetcher.Abstractions.FetchResult([], null);
        await Task.CompletedTask;
    }

    private static PollLoop MakePollLoop(IFetcherReadinessIndicator? readiness = null)
    {
        var adapter = Substitute.For<Dashboard.Fetcher.Abstractions.ICiCdAdapter>();
        adapter.AdapterId.Returns("github-actions");
        adapter.FetchAsync(
            Arg.Any<string?>(),
            Arg.Any<CancellationToken>())
            .Returns(EmptyChunks());

        var ingest = Substitute.For<Dashboard.Fetcher.Ingest.IIngestClient>();
        var state = Substitute.For<Dashboard.Fetcher.Ingest.IFetcherStateClient>();
        state.GetAsync(
            Arg.Any<string>(),
            Arg.Any<CancellationToken>())
            .Returns((string?)null);

        return new PollLoop(
            adapter, ingest, state,
            pollInterval: TimeSpan.FromHours(1),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<PollLoop>.Instance,
            readiness);
    }
}
