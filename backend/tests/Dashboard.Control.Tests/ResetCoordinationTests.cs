using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="ResetCoordination"/> shared constants and helpers.
/// No DB required — all tests are pure.
/// </summary>
public sealed class ResetCoordinationTests
{
    // ── Constants ──────────────────────────────────────────────────────────────

    [Fact]
    public void AdvisoryLockKey_IsExpectedValue()
        => Assert.Equal(7_654_321L, ResetCoordination.AdvisoryLockKey);

    [Fact]
    public void PostgresConnectionName_IsExpectedValue()
        => Assert.Equal("Postgres", ResetCoordination.PostgresConnectionName);

    [Theory]
    [InlineData("reset-initiated", nameof(ResetCoordination.EventResetInitiated))]
    [InlineData("reset-started", nameof(ResetCoordination.EventResetStarted))]
    [InlineData("reset-completed", nameof(ResetCoordination.EventResetCompleted))]
    public void EventTypeConstants_HaveExpectedValues(string expected, string constantName)
    {
        var value = constantName switch
        {
            nameof(ResetCoordination.EventResetInitiated) => ResetCoordination.EventResetInitiated,
            nameof(ResetCoordination.EventResetStarted) => ResetCoordination.EventResetStarted,
            nameof(ResetCoordination.EventResetCompleted) => ResetCoordination.EventResetCompleted,
            _ => throw new InvalidOperationException(constantName),
        };
        Assert.Equal(expected, value);
    }

    [Fact]
    public void ComponentWildcard_IsAsterisk()
        => Assert.Equal("*", ResetCoordination.ComponentWildcard);

    // ── BuildControlEvent ──────────────────────────────────────────────────────

    [Fact]
    public void BuildControlEvent_SetsTypeAndCorrelationId()
    {
        var correlationId = Guid.CreateVersion7();
        var ev = ResetCoordination.BuildControlEvent("reset-completed", correlationId);

        Assert.Equal("reset-completed", ev.Type);
        Assert.Equal(correlationId, ev.CorrelationId);
    }

    [Fact]
    public void BuildControlEvent_SetsComponentToWildcard()
    {
        var ev = ResetCoordination.BuildControlEvent("reset-started", Guid.CreateVersion7());
        Assert.Equal(ResetCoordination.ComponentWildcard, ev.Component);
    }

    [Fact]
    public void BuildControlEvent_AssignsNewUuidV7Id()
    {
        var ev1 = ResetCoordination.BuildControlEvent("reset-completed", Guid.CreateVersion7());
        var ev2 = ResetCoordination.BuildControlEvent("reset-completed", Guid.CreateVersion7());

        Assert.NotEqual(Guid.Empty, ev1.Id);
        Assert.NotEqual(ev1.Id, ev2.Id);
    }

    [Fact]
    public void BuildControlEvent_OccurredAt_IsUtcNow()
    {
        var before = DateTimeOffset.UtcNow;
        var ev = ResetCoordination.BuildControlEvent("reset-initiated", Guid.CreateVersion7());
        var after = DateTimeOffset.UtcNow;

        Assert.True(ev.OccurredAt >= before);
        Assert.True(ev.OccurredAt <= after);
    }

    // ── ClearCycleFields ───────────────────────────────────────────────────────

    [Fact]
    public void ClearCycleFields_SetsStateToIdle()
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            CorrelationId = Guid.CreateVersion7(),
            ExpectedComponents = ["a", "b"],
            AcksReceived = ["a"],
            StartedAt = DateTimeOffset.UtcNow,
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };

        ResetCoordination.ClearCycleFields(cycle);

        Assert.Equal(ResetState.Idle, cycle.State);
    }

    [Fact]
    public void ClearCycleFields_NullsAllOptionalFields()
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Resetting,
            CorrelationId = Guid.CreateVersion7(),
            ExpectedComponents = ["a"],
            AcksReceived = ["a"],
            StartedAt = DateTimeOffset.UtcNow,
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(30),
        };

        ResetCoordination.ClearCycleFields(cycle);

        Assert.Null(cycle.CorrelationId);
        Assert.Null(cycle.ExpectedComponents);
        Assert.Null(cycle.AcksReceived);
        Assert.Null(cycle.StartedAt);
        Assert.Null(cycle.DeadlineAt);
    }

    [Fact]
    public void ClearCycleFields_IdempotentWhenAlreadyIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Idle };

        // Must not throw.
        ResetCoordination.ClearCycleFields(cycle);

        Assert.Equal(ResetState.Idle, cycle.State);
        Assert.Null(cycle.CorrelationId);
    }
}
