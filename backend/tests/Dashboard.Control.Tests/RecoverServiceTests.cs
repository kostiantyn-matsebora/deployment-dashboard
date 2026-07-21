using System.Reflection;
using Dashboard.Control.Models;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for the recover choreography (issue #423) — the non-destructive counterpart of
/// <see cref="ResetService"/>/<see cref="ResetServiceTests"/>. Covers: single-flight claim
/// shared with reset (409 mutual exclusion in both directions), <c>recover-initiated</c>
/// emission + payload shape, the <c>since</c> XOR <c>days_back</c> resolution rule (via
/// reflection into <see cref="ControlEndpoints"/>'s private resolver — a pure function with
/// no I/O), and the recover state machine transitions. Uses SQLite in-memory — no mocks, real
/// EF Core repositories, plain recording fakes for the notifier/orchestrator collaborators.
/// </summary>
public sealed class RecoverServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;
    private readonly ControlStreamRepository _controlStreamRepo;
    private readonly RecordingControlEventNotifier _notifier = new();
    private readonly NullRecoverOrchestrator _orchestrator = new();
    private readonly NullHostApplicationLifetime _lifetime = new();

    public RecoverServiceTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();

        // Seed the single idle row (mirrors the migration seed — required by TryClaimIdleAsync's
        // conditional UPDATE; without the row it affects 0 rows even when logically idle).
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private RecoverService BuildService(ResetOptions? opts = null)
    {
        var options = Microsoft.Extensions.Options.Options.Create(opts ?? DefaultOptions());
        return new RecoverService(
            _cycleRepo,
            _controlStreamRepo,
            _notifier,
            _orchestrator,
            _lifetime,
            options,
            NullLogger<RecoverService>.Instance);
    }

    private static ResetOptions DefaultOptions() => new()
    {
        AckTimeoutSeconds = 10,
        ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
        GateMaxTtlSeconds = 60,
    };

    /// <summary>Forcibly writes a non-idle cycle directly, bypassing the atomic claim path —
    /// used to simulate "a reset (or recover) is already in flight".</summary>
    private async Task SeedCycleAsync(string state, string operation = ControlOperation.Reset)
    {
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);
        cycle.State = state;
        cycle.Operation = operation;
        cycle.CorrelationId = Guid.CreateVersion7();
        cycle.StartedAt = DateTimeOffset.UtcNow;
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10);
        if (operation == ControlOperation.Recover)
            cycle.RecoverSince = DateTimeOffset.UtcNow.AddDays(-1);
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
    }

    // ── TryInitiateAsync: happy path (202) ─────────────────────────────────────

    [Fact]
    public async Task TryInitiate_WhenIdle_ReturnsAcceptanceWithDrainingStateAndSince()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var svc = BuildService();

        var result = await svc.TryInitiateAsync(since);

        Assert.NotNull(result);
        Assert.Equal(ResetState.Draining, result.State);
        Assert.Equal(since, result.Since);
        Assert.NotEqual(Guid.Empty, result.CorrelationId);
    }

    [Fact]
    public async Task TryInitiate_PersistsDrainingState_WithOperationRecoverAndRecoverSince()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var svc = BuildService();

        await svc.TryInitiateAsync(since);

        _db.ChangeTracker.Clear();
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Draining, loaded.State);
        Assert.Equal(ControlOperation.Recover, loaded.Operation);
        Assert.Equal(since, loaded.RecoverSince);
    }

    [Fact]
    public async Task TryInitiate_EmitsRecoverInitiatedEvent_IdEqualsCorrelationId()
    {
        var since = DateTimeOffset.UtcNow.AddDays(-3);
        var svc = BuildService();

        var acceptance = await svc.TryInitiateAsync(since);

        var events = await _db.ControlStreamEvents.ToListAsync();
        var ev = Assert.Single(events);
        Assert.Equal("recover-initiated", ev.Type);
        Assert.Equal("*", ev.Component);
        Assert.Equal(acceptance!.CorrelationId, ev.Id);
        // recover-initiated carries its own id as correlation_id (mirrors reset-initiated).
        Assert.Equal(acceptance.CorrelationId, ev.CorrelationId);

        var announced = Assert.Single(_notifier.Notified);
        Assert.Equal("recover-initiated", announced.Type);
        Assert.Equal(acceptance.CorrelationId, announced.Id);
    }

    [Fact]
    public async Task TryInitiate_PassesApplicationStoppingToken_ToOrchestrator()
    {
        var trackingOrchestrator = new TokenCapturingOrchestrator();
        var opts = Microsoft.Extensions.Options.Options.Create(DefaultOptions());
        var svc = new RecoverService(
            _cycleRepo, _controlStreamRepo, _notifier, trackingOrchestrator, _lifetime, opts,
            NullLogger<RecoverService>.Instance);

        await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-1));

        await Task.Delay(50);
        Assert.True(trackingOrchestrator.WasCalled, "Orchestrator must have been called.");
        Assert.Equal(_lifetime.ApplicationStopping, trackingOrchestrator.ReceivedToken);
    }

    // ── Single-flight claim: 409 mutual exclusion with reset AND recover ──────

    [Fact]
    public async Task TryInitiate_WhenResetIsDraining_Returns409Null()
    {
        await SeedCycleAsync(ResetState.Draining, ControlOperation.Reset);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-1));

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_WhenResetIsResetting_Returns409Null()
    {
        await SeedCycleAsync(ResetState.Resetting, ControlOperation.Reset);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-1));

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_WhenAnotherRecoverIsDraining_Returns409Null()
    {
        await SeedCycleAsync(ResetState.Draining, ControlOperation.Recover);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-1));

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_CalledTwiceSequentially_SecondReturnsNull()
    {
        var svc = BuildService();
        var first = await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-1));
        Assert.NotNull(first);

        _db.ChangeTracker.Clear();
        var second = await svc.TryInitiateAsync(DateTimeOffset.UtcNow.AddDays(-2));
        Assert.Null(second);
    }

    /// <summary>
    /// Symmetric to the recover-vs-reset 409 above: a reset attempted while a recover is
    /// draining must ALSO be rejected — the two operations share one slot regardless of
    /// direction. Exercised via the raw <see cref="IResetCycleRepository.TryClaimIdleAsync"/>
    /// atomic claim (the same primitive both ResetService and RecoverService call).
    /// </summary>
    [Fact]
    public async Task TryClaimIdleAsync_WhenRecoverIsDraining_ResetClaimAlsoReturnsFalse()
    {
        await SeedCycleAsync(ResetState.Draining, ControlOperation.Recover);

        var resetClaim = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            Operation = ControlOperation.Reset,
            CorrelationId = Guid.CreateVersion7(),
            ExpectedComponents = ["x"],
            AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow,
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };
        _db.ChangeTracker.Clear();

        var claimed = await _cycleRepo.TryClaimIdleAsync(resetClaim, CancellationToken.None);

        Assert.False(claimed);
    }

    // ── since / days_back resolution (ControlEndpoints.ResolveRecoverSince) ───
    //
    // The XOR-resolution rule is a pure function that lives on the endpoint (private static —
    // the 422 Problem it builds is endpoint-shaped, not service-shaped). It is invoked here via
    // reflection so the rule gets real unit coverage without standing up a live HTTP pipeline
    // (that full-stack 422 path is also covered by Dashboard.Api.Tests, deferred to CI). This
    // exercises the actual production method — not a reimplementation/mock of its logic.

    private static (DateTimeOffset? Since, IResult? Error) ResolveRecoverSince(RecoverRequest body, ResetOptions? options = null)
    {
        var method = typeof(ControlEndpoints).GetMethod(
            "ResolveRecoverSince", BindingFlags.NonPublic | BindingFlags.Static)!;
        var result = method.Invoke(null, [body, options ?? new ResetOptions()])!;
        var type = result.GetType();
        var since = (DateTimeOffset?)type.GetField("Item1")!.GetValue(result);
        var error = (IResult?)type.GetField("Item2")!.GetValue(result);
        return (since, error);
    }

    [Fact]
    public void ResolveRecoverSince_SinceOnly_ResolvesToSuppliedValue()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { Since = since });

        Assert.Null(error);
        Assert.Equal(since, resolved);
    }

    [Fact]
    public void ResolveRecoverSince_DaysBackOnly_ResolvesToNowMinusDays()
    {
        var before = DateTimeOffset.UtcNow;
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = 3 });
        var after = DateTimeOffset.UtcNow;

        Assert.Null(error);
        Assert.NotNull(resolved);
        Assert.InRange(resolved!.Value, before.AddDays(-3).AddSeconds(-2), after.AddDays(-3).AddSeconds(2));
    }

    [Fact]
    public void ResolveRecoverSince_BothSuppliedAndNeitherSupplied_Return422Error()
    {
        var (_, bothError) = ResolveRecoverSince(new RecoverRequest
        {
            Since = DateTimeOffset.UtcNow,
            DaysBack = 3,
        });
        Assert.NotNull(bothError);

        var (_, neitherError) = ResolveRecoverSince(new RecoverRequest());
        Assert.NotNull(neitherError);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void ResolveRecoverSince_DaysBackLessThanOne_Returns422Error(int daysBack)
    {
        var (_, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = daysBack });
        Assert.NotNull(error);
    }

    [Fact]
    public void ResolveRecoverSince_DaysBackExactlyOne_IsValid()
    {
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = 1 });
        Assert.Null(error);
        Assert.NotNull(resolved);
    }

    // ── days_back / since bound (RecoverMaxDaysBack — security fix #423) ──────
    //
    // Bounds the rewind window so an unbounded days_back can neither overflow
    // DateTimeOffset.AddDays (int.MaxValue -> ArgumentOutOfRangeException -> uncaught 500) nor
    // force the fetcher into an unbounded re-poll. The bound is a ResetOptions knob
    // (RecoverMaxDaysBack, mirrors the Reset:* option style), default 90 days.

    [Fact]
    public void ResolveRecoverSince_DaysBackExactlyAtMax_IsValid()
    {
        var options = new ResetOptions { RecoverMaxDaysBack = 30 };
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = 30 }, options);

        Assert.Null(error);
        Assert.NotNull(resolved);
    }

    [Fact]
    public void ResolveRecoverSince_DaysBackOneOverMax_Returns422Error()
    {
        var options = new ResetOptions { RecoverMaxDaysBack = 30 };
        var (_, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = 31 }, options);

        Assert.NotNull(error);
    }

    [Fact]
    public void ResolveRecoverSince_DaysBackIntMaxValue_Returns422ErrorWithoutThrowing()
    {
        // The historical vulnerability: DateTimeOffset.UtcNow.AddDays(-int.MaxValue) throws
        // ArgumentOutOfRangeException uncaught -> 500. The bound check must reject this BEFORE
        // AddDays is ever called, so resolving it must neither throw nor succeed.
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { DaysBack = int.MaxValue });

        Assert.NotNull(error);
        Assert.Null(resolved);
    }

    [Fact]
    public void ResolveRecoverSince_SinceWithinMaxDaysBack_IsValid()
    {
        var options = new ResetOptions { RecoverMaxDaysBack = 30 };
        var since = DateTimeOffset.UtcNow.AddDays(-29);
        var (resolved, error) = ResolveRecoverSince(new RecoverRequest { Since = since }, options);

        Assert.Null(error);
        Assert.Equal(since, resolved);
    }

    [Fact]
    public void ResolveRecoverSince_SinceOlderThanMaxDaysBack_Returns422Error()
    {
        var options = new ResetOptions { RecoverMaxDaysBack = 30 };
        var since = DateTimeOffset.UtcNow.AddDays(-31);
        var (_, error) = ResolveRecoverSince(new RecoverRequest { Since = since }, options);

        Assert.NotNull(error);
    }

    [Fact]
    public void ResolveRecoverSince_DefaultRecoverMaxDaysBack_Is90()
    {
        Assert.Equal(90, new ResetOptions().RecoverMaxDaysBack);
    }

    // ── Recover state machine transitions (mirrors ResetStateMachine coverage) ─

    [Fact]
    public void RecoverStateMachine_Idle_CanFireStart()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Idle };
        var sm = new RecoverStateMachine(cycle);
        Assert.True(sm.CanFire(RecoverTrigger.Start));
        sm.Fire(RecoverTrigger.Start);
        Assert.True(sm.IsInState(ResetState.Draining));
    }

    [Fact]
    public void RecoverStateMachine_Draining_AcksInFiresResetting()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new RecoverStateMachine(cycle);
        sm.Fire(RecoverTrigger.AcksIn);
        Assert.True(sm.IsInState(ResetState.Resetting));
    }

    [Fact]
    public void RecoverStateMachine_Resetting_CompleteFiresIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Resetting };
        var sm = new RecoverStateMachine(cycle);
        sm.Fire(RecoverTrigger.Complete);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    [Fact]
    public void RecoverStateMachine_Draining_AbortFiresIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new RecoverStateMachine(cycle);
        sm.Fire(RecoverTrigger.Abort);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    [Fact]
    public void RecoverStateMachine_Draining_StartIgnored()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new RecoverStateMachine(cycle);
        sm.Fire(RecoverTrigger.Start); // must not throw
        Assert.True(sm.IsInState(ResetState.Draining));
    }

    // ── Stubs / recording doubles ─────────────────────────────────────────────

    private sealed class RecordingControlEventNotifier : IControlEventNotifier
    {
        public List<ControlStreamEvent> Notified { get; } = [];

        public Task NotifyAsync(ControlStreamEvent ev, CancellationToken ct = default)
        {
            Notified.Add(ev);
            return Task.CompletedTask;
        }
    }

    private sealed class NullRecoverOrchestrator : IRecoverOrchestrator
    {
        public Task DriveAsync(Guid recoverId, ResetOptions options, CancellationToken appStopping)
            => Task.CompletedTask;
    }

    private sealed class TokenCapturingOrchestrator : IRecoverOrchestrator
    {
        public bool WasCalled { get; private set; }
        public CancellationToken ReceivedToken { get; private set; }

        public Task DriveAsync(Guid recoverId, ResetOptions options, CancellationToken appStopping)
        {
            WasCalled = true;
            ReceivedToken = appStopping;
            return Task.CompletedTask;
        }
    }

    private sealed class NullHostApplicationLifetime : IHostApplicationLifetime
    {
        private readonly CancellationTokenSource _cts = new();
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => _cts.Token;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() => _cts.Cancel();
    }
}
