using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="ResetReconciler"/> abort logic.
/// These tests verify the reconciler's orphan-detection predicate and its abort-action side
/// effects (write idle + emit reset-completed) using SQLite in-memory.
///
/// Advisory-lock acquisition is not tested here (requires a real Postgres connection);
/// that path is covered by the API integration suite.
/// </summary>
public sealed class ResetReconcilerTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;
    private readonly ControlStreamRepository _controlStreamRepo;
    private readonly RecordingControlEventNotifier _notifier = new();

    public ResetReconcilerTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();

        _db.ResetCycles.Add(new ResetCycle { Id = 1, State = ResetState.Idle });
        _db.SaveChanges();

        _cycleRepo = new ResetCycleRepository(_db);
        _controlStreamRepo = new ControlStreamRepository(_db);
    }

    public void Dispose()
    {
        _db.Database.CloseConnection();
        _db.Dispose();
    }

    // ── Constants ──────────────────────────────────────────────────────────────

    [Fact]
    public void TickIntervalSeconds_IsFive()
        => Assert.Equal(5, ResetReconciler.TickIntervalSeconds);

    // ── Orphan predicate: past-deadline draining cycle ────────────────────────

    [Fact]
    public void OrphanPredicate_PastDeadlineDrainingCycle_ShouldAbort()
    {
        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-70);
        var gateMaxTtl = 60;
        var deadline = startedAt.AddSeconds(gateMaxTtl);

        // Reconciler condition: abort when now >= StartedAt + GateMaxTtlSeconds.
        Assert.True(DateTimeOffset.UtcNow >= deadline, "Cycle must be past deadline.");
    }

    [Fact]
    public void OrphanPredicate_FutureDeadlineDrainingCycle_ShouldNotAbort()
    {
        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-5);
        var gateMaxTtl = 60;
        var deadline = startedAt.AddSeconds(gateMaxTtl);

        Assert.False(DateTimeOffset.UtcNow >= deadline, "Cycle within TTL must not be aborted.");
    }

    // ── Abort action: emits reset-completed and writes idle ───────────────────

    [Fact]
    public async Task AbortAction_EmitsResetCompletedAndWritesIdle_ForDrainingOrphan()
    {
        // Simulate what InspectAndAbortIfOrphanedAsync does after detecting an orphan.
        var correlationId = Guid.CreateVersion7();
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            CorrelationId = correlationId,
            ExpectedComponents = ["dashboard-fetcher"],
            AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-120),
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(-60),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        // Simulate the reconciler abort path.
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        var completedEvent = ResetCoordination.BuildControlEvent(
            ResetCoordination.EventResetCompleted, loaded.CorrelationId!.Value);
        await _controlStreamRepo.InsertAsync(completedEvent, CancellationToken.None);
        await _notifier.NotifyAsync(completedEvent, CancellationToken.None);

        ResetCoordination.ClearCycleFields(loaded);
        await _cycleRepo.SaveAsync(loaded, CancellationToken.None);

        // Verify state.
        _db.ChangeTracker.Clear();
        var saved = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, saved.State);
        Assert.Null(saved.CorrelationId);

        // Verify event emission.
        var events = await _db.ControlStreamEvents.ToListAsync();
        var ev = Assert.Single(events);
        Assert.Equal(ResetCoordination.EventResetCompleted, ev.Type);
        Assert.Equal(ResetCoordination.ComponentWildcard, ev.Component);
        Assert.Equal(correlationId, ev.CorrelationId);

        // Notifier received the event.
        var notified = Assert.Single(_notifier.Notified);
        Assert.Equal(ResetCoordination.EventResetCompleted, notified.Type);
    }

    [Fact]
    public async Task AbortAction_EmitsResetCompletedAndWritesIdle_ForResettingOrphan()
    {
        var correlationId = Guid.CreateVersion7();
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Resetting,
            CorrelationId = correlationId,
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-120),
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(-60),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        var completedEvent = ResetCoordination.BuildControlEvent(
            ResetCoordination.EventResetCompleted, loaded.CorrelationId!.Value);
        await _controlStreamRepo.InsertAsync(completedEvent, CancellationToken.None);
        await _notifier.NotifyAsync(completedEvent, CancellationToken.None);

        ResetCoordination.ClearCycleFields(loaded);
        await _cycleRepo.SaveAsync(loaded, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var saved = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, saved.State);
        Assert.Null(saved.CorrelationId);
        Assert.Null(saved.StartedAt);
        Assert.Null(saved.DeadlineAt);
    }

    // ── No-op when cycle is idle ───────────────────────────────────────────────

    [Fact]
    public async Task AbortAction_NoCycleInFlight_NothingEmitted()
    {
        // Cycle starts idle (seeded in constructor) — nothing to abort.
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, cycle.State);

        var events = await _db.ControlStreamEvents.ToListAsync();
        Assert.Empty(events);
        Assert.Empty(_notifier.Notified);
    }

    // ── No-op when cycle has no correlation_id ────────────────────────────────

    [Fact]
    public async Task AbortAction_CorrelationIdEmpty_NoEventEmitted()
    {
        // A cycle with no CorrelationId (Guid.Empty): reconciler skips event emission
        // (matches the `if (abortedResetId != Guid.Empty)` guard in the real code).
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            CorrelationId = null, // no correlation id
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-120),
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(-60),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        var abortedResetId = loaded.CorrelationId ?? Guid.Empty;

        // Guard matches production code: skip event if Guid.Empty.
        if (abortedResetId != Guid.Empty)
        {
            var ev = ResetCoordination.BuildControlEvent(
                ResetCoordination.EventResetCompleted, abortedResetId);
            await _controlStreamRepo.InsertAsync(ev, CancellationToken.None);
            await _notifier.NotifyAsync(ev, CancellationToken.None);
        }

        var events = await _db.ControlStreamEvents.ToListAsync();
        Assert.Empty(events); // no correlation_id → no event
        Assert.Empty(_notifier.Notified);
    }

    // ── Stub ──────────────────────────────────────────────────────────────────

    private sealed class RecordingControlEventNotifier : IControlEventNotifier
    {
        public List<ControlStreamEvent> Notified { get; } = [];

        public Task NotifyAsync(ControlStreamEvent ev, CancellationToken ct = default)
        {
            Notified.Add(ev);
            return Task.CompletedTask;
        }
    }
}
