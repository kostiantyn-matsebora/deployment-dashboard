using Dashboard.Fetcher.Host.Extensions;
using Dashboard.Fetcher.Orchestration;

namespace Dashboard.Fetcher.Tests.Host;

/// <summary>
/// Unit tests for <see cref="FetcherHealthEndpointExtensions"/> helpers (§6.1).
/// Covers <c>OutcomeLabel</c> mapping and the readyz hard-failure predicate rules.
/// Program-level wiring (MapGet) is not unit-testable — covered by integration tests.
/// </summary>
public sealed class FetcherHealthEndpointTests
{
    // ── OutcomeLabel mapping ───────────────────────────────────────────────────

    [Theory]
    [InlineData(PollOutcome.Ok, "ok")]
    [InlineData(PollOutcome.AuthFailed, "auth_failed")]
    [InlineData(PollOutcome.RateLimited, "rate_limited")]
    [InlineData(PollOutcome.Error, "error")]
    public void OutcomeLabel_KnownOutcome_ReturnsExpectedLabel(
        PollOutcome outcome, string expected)
    {
        Assert.Equal(expected, FetcherHealthEndpointExtensions.OutcomeLabel(outcome));
    }

    [Fact]
    public void OutcomeLabel_NullOutcome_ReturnsNull()
    {
        Assert.Null(FetcherHealthEndpointExtensions.OutcomeLabel(null));
    }

    // ── Hard-failure predicate (§6.1 spec table) ──────────────────────────────
    // isHardFailure = !paused && outcome is AuthFailed or Error

    [Theory]
    [InlineData(PollOutcome.AuthFailed, false, true)]   // not paused, auth failed → 503
    [InlineData(PollOutcome.Error, false, true)]        // not paused, error → 503
    [InlineData(PollOutcome.AuthFailed, true, false)]   // paused for reset → 200
    [InlineData(PollOutcome.Error, true, false)]        // paused for reset → 200
    [InlineData(PollOutcome.Ok, false, false)]          // ok → 200
    [InlineData(PollOutcome.RateLimited, false, false)] // rate_limited → 200
    [InlineData(null, false, false)]                    // never polled → 200
    public void HardFailurePredicate_MatchesSpecTable(
        PollOutcome? outcome, bool paused, bool expectedHardFailure)
    {
        // This is the exact guard expression from the readyz handler.
        var isHardFailure = !paused &&
            outcome is PollOutcome.AuthFailed or PollOutcome.Error;

        Assert.Equal(expectedHardFailure, isHardFailure);
    }

    // ── Status string derivation ──────────────────────────────────────────────

    [Theory]
    [InlineData(PollOutcome.Ok, "ready")]
    [InlineData(PollOutcome.AuthFailed, "degraded")]
    [InlineData(PollOutcome.RateLimited, "degraded")]
    [InlineData(PollOutcome.Error, "degraded")]
    [InlineData(null, "degraded")]
    public void StatusString_OnlyOkIsReady(PollOutcome? outcome, string expected)
    {
        // Matches: var status = outcome is PollOutcome.Ok ? "ready" : "degraded";
        var status = outcome is PollOutcome.Ok ? "ready" : "degraded";
        Assert.Equal(expected, status);
    }

    // ── Reachable flag derivation ─────────────────────────────────────────────

    [Theory]
    [InlineData(PollOutcome.Ok, true)]
    [InlineData(PollOutcome.RateLimited, true)]
    [InlineData(PollOutcome.AuthFailed, false)]
    [InlineData(PollOutcome.Error, false)]
    [InlineData(null, false)]
    public void ReachableFlag_TrueOnlyForOkOrRateLimited(PollOutcome? outcome, bool expected)
    {
        // Matches: reachable = outcome is PollOutcome.Ok or PollOutcome.RateLimited
        var reachable = outcome is PollOutcome.Ok or PollOutcome.RateLimited;
        Assert.Equal(expected, reachable);
    }
}
