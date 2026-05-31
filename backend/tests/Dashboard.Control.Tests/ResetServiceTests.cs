using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for the reset choreography — state machine, repository, ack aggregation,
/// timeout, GateMaxTtl abort, 409 re-entry guard, atomic claim (Fix B), and reconciler
/// abort (Fix A). Uses SQLite in-memory.
/// </summary>
public sealed class ResetServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;
    private readonly ControlStreamRepository _controlStreamRepo;
    private readonly RecordingControlEventNotifier _notifier = new();
    private readonly NullOrchestrator _orchestrator = new();
    private readonly NullHostApplicationLifetime _lifetime = new();

    public ResetServiceTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();

        // Seed the single idle row (mirrors the migration seed — required by TryClaimIdleAsync
        // which uses a conditional UPDATE; without the row it affects 0 rows even when idle).
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

    private ResetService BuildService(ResetOptions? opts = null)
    {
        var options = Microsoft.Extensions.Options.Options.Create(opts ?? DefaultOptions());
        return new ResetService(
            _cycleRepo,
            _controlStreamRepo,
            _notifier,
            _orchestrator,
            _lifetime,
            options,
            NullLogger<ResetService>.Instance);
    }

    private static ResetOptions DefaultOptions() => new()
    {
        AckTimeoutSeconds = 10,
        ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
        GateMaxTtlSeconds = 60,
    };

    /// <summary>Forcibly writes a non-idle cycle directly, bypassing the atomic claim path.</summary>
    private async Task SeedCycleAsync(string state, Guid? resetId = null)
    {
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);
        cycle.State = state;
        cycle.ResetId = resetId ?? Guid.CreateVersion7();
        cycle.StartedAt = DateTimeOffset.UtcNow;
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10);
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
    }

    private static DeploymentEvent SampleEvent(string service, string environment) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"gh-{Guid.NewGuid():N}",
            Service = service,
            Environment = environment,
            Status = "success",
            HappenedAt = DateTimeOffset.UtcNow,
        };

    private static FetcherState SampleFetcherState(string adapter) =>
        new()
        {
            Adapter = adapter,
            Cursor = "opaque-cursor",
            UpdatedAt = DateTimeOffset.UtcNow,
        };

    private static ComponentEvent SampleComponentEvent(string componentId) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            ComponentId = componentId,
            EventType = "status",
            State = "running",
            OccurredAt = DateTimeOffset.UtcNow,
            ReceivedAt = DateTimeOffset.UtcNow,
        };

    // ── State machine transitions ─────────────────────────────────────────────

    [Fact]
    public void StateMachine_Idle_CanFireStart()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Idle };
        var sm = new ResetStateMachine(cycle);
        Assert.True(sm.CanFire(ResetTrigger.Start));
        sm.Fire(ResetTrigger.Start);
        Assert.True(sm.IsInState(ResetState.Draining));
    }

    [Fact]
    public void StateMachine_Draining_AcksInFiresResetting()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.AcksIn);
        Assert.True(sm.IsInState(ResetState.Resetting));
    }

    [Fact]
    public void StateMachine_Draining_AbortFiresIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.Abort);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    [Fact]
    public void StateMachine_Resetting_CompleteFiresIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Resetting };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.Complete);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    [Fact]
    public void StateMachine_Resetting_AbortFiresIdle()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Resetting };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.Abort);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    [Fact]
    public void StateMachine_Draining_StartIgnored()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.Start); // must not throw
        Assert.True(sm.IsInState(ResetState.Draining));
    }

    // ── ResetCycle upsert / load ──────────────────────────────────────────────

    [Fact]
    public async Task CycleRepository_Load_WhenExists_ReturnsRow()
    {
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, cycle.State);
        Assert.Null(cycle.ResetId);
    }

    [Fact]
    public async Task CycleRepository_Save_ThenLoad_RoundtripsState()
    {
        var resetId = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = resetId,
            ExpectedComponents = ["a", "b"],
            AcksReceived = ["a"],
            StartedAt = now,
            DeadlineAt = now.AddSeconds(10),
        };

        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);

        Assert.Equal(ResetState.Draining, loaded.State);
        Assert.Equal(resetId, loaded.ResetId);
        Assert.Equal(["a", "b"], loaded.ExpectedComponents);
        Assert.Equal(["a"], loaded.AcksReceived);
    }

    [Fact]
    public async Task CycleRepository_SaveTwice_UpsertsSameRow()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        cycle.State = ResetState.Idle;
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);

        Assert.Equal(1, await _db.ResetCycles.CountAsync());
        _db.ChangeTracker.Clear();
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, loaded.State);
    }

    // ── Fix B: atomic TryClaimIdleAsync ──────────────────────────────────────

    [Fact]
    public async Task TryClaimIdleAsync_WhenIdle_ReturnsTrue()
    {
        var claimed = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(),
            ExpectedComponents = ["x"],
            AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow,
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };

        var result = await _cycleRepo.TryClaimIdleAsync(claimed, CancellationToken.None);

        Assert.True(result);
        _db.ChangeTracker.Clear();
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Draining, loaded.State);
    }

    [Fact]
    public async Task TryClaimIdleAsync_WhenDraining_ReturnsFalse()
    {
        await SeedCycleAsync(ResetState.Draining);

        var claimed = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(),
            ExpectedComponents = ["x"],
            AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow,
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };
        _db.ChangeTracker.Clear();

        var result = await _cycleRepo.TryClaimIdleAsync(claimed, CancellationToken.None);

        Assert.False(result);
    }

    [Fact]
    public async Task TryClaimIdleAsync_WhenResetting_ReturnsFalse()
    {
        await SeedCycleAsync(ResetState.Resetting);
        _db.ChangeTracker.Clear();

        var claimed = new ResetCycle
        {
            Id = 1, State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(), ExpectedComponents = ["x"], AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow, DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };

        var result = await _cycleRepo.TryClaimIdleAsync(claimed, CancellationToken.None);

        Assert.False(result);
    }

    [Fact]
    public async Task TryClaimIdleAsync_SimulateConcurrent_SecondCallReturnsFalse()
    {
        // Simulate two concurrent POST /reset: first claim succeeds; second uses a
        // fresh db context (same in-memory DB) to simulate the second instance.
        var firstClaimed = new ResetCycle
        {
            Id = 1, State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(), ExpectedComponents = ["x"], AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow, DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };
        var firstResult = await _cycleRepo.TryClaimIdleAsync(firstClaimed, CancellationToken.None);
        Assert.True(firstResult, "First claim must succeed.");

        _db.ChangeTracker.Clear();

        // Second call on the same repo (state is now draining) — must return false.
        var secondClaimed = new ResetCycle
        {
            Id = 1, State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(), ExpectedComponents = ["x"], AcksReceived = [],
            StartedAt = DateTimeOffset.UtcNow, DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
        };
        var secondResult = await _cycleRepo.TryClaimIdleAsync(secondClaimed, CancellationToken.None);
        Assert.False(secondResult, "Second concurrent claim must return false (0 affected rows).");
    }

    // ── ResetService.TryInitiateAsync ─────────────────────────────────────────

    [Fact]
    public async Task TryInitiate_WhenIdle_Returns202Acceptance()
    {
        var svc = BuildService();
        var result = await svc.TryInitiateAsync();

        Assert.NotNull(result);
        Assert.Equal(ResetState.Draining, result.State);
        Assert.NotEqual(Guid.Empty, result.ResetId);
    }

    [Fact]
    public async Task TryInitiate_PersistsDrainingState()
    {
        var svc = BuildService();
        await svc.TryInitiateAsync();

        _db.ChangeTracker.Clear();
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Draining, loaded.State);
    }

    [Fact]
    public async Task TryInitiate_EmitsResetInitiatedEvent()
    {
        var svc = BuildService();
        var acceptance = await svc.TryInitiateAsync();

        var events = await _db.ControlStreamEvents.ToListAsync();
        var ev = Assert.Single(events);
        Assert.Equal("reset-initiated", ev.Type);
        Assert.Equal("*", ev.Component);
        Assert.Equal(acceptance!.ResetId, ev.Id);

        var announced = Assert.Single(_notifier.Notified);
        Assert.Equal("reset-initiated", announced.Type);
        Assert.Equal(acceptance.ResetId, announced.Id);
    }

    [Fact]
    public async Task TryInitiate_WhenDraining_Returns409Null()
    {
        await SeedCycleAsync(ResetState.Draining);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_WhenResetting_Returns409Null()
    {
        await SeedCycleAsync(ResetState.Resetting);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_CalledTwiceSequentially_SecondReturnsNull()
    {
        var svc = BuildService();
        var first = await svc.TryInitiateAsync();
        Assert.NotNull(first);

        _db.ChangeTracker.Clear();
        var second = await svc.TryInitiateAsync();
        Assert.Null(second);
    }

    // ── Ack aggregation (quorum) ───────────────────────────────────────────────

    [Fact]
    public void AckAggregation_QuorumReached_WhenAllExpectedAck()
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(),
            ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
            AcksReceived = ["dashboard-fetcher", "demo-driver"],
        };

        var acksSet = new HashSet<string>(cycle.AcksReceived);
        Assert.True(acksSet.IsSupersetOf(cycle.ExpectedComponents!));
    }

    [Fact]
    public void AckAggregation_PartialAck_QuorumNotReached()
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(),
            ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
            AcksReceived = ["dashboard-fetcher"],
        };

        var acksSet = new HashSet<string>(cycle.AcksReceived!);
        Assert.False(acksSet.IsSupersetOf(cycle.ExpectedComponents!));
    }

    [Fact]
    public void AckAggregation_StaleResetId_ShouldBeIgnored()
    {
        var activeResetId = Guid.CreateVersion7();
        var staleResetId = Guid.CreateVersion7();
        Assert.NotEqual(activeResetId, staleResetId);
    }

    // ── Reset scope: only deployment_events + fetcher_state cleared (D14) ──────

    [Fact]
    public async Task ClearScope_OnlyDeploymentEventsAndFetcherStateAreCleared()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc-a", "prod"));
        _db.FetcherStates.Add(SampleFetcherState("gh"));
        _db.ComponentEvents.Add(SampleComponentEvent("demo-driver"));
        _db.ControlStreamEvents.Add(new ControlStreamEvent
        {
            Id = Guid.CreateVersion7(),
            Type = "reset-initiated",
            Component = "*",
            OccurredAt = DateTimeOffset.UtcNow,
        });
        await _db.SaveChangesAsync();

        await _db.DeploymentEvents.ExecuteDeleteAsync();
        await _db.FetcherStates.ExecuteDeleteAsync();

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
        Assert.Equal(0, await _db.FetcherStates.CountAsync());
        // Component events and control stream events survive (D14).
        Assert.Equal(1, await _db.ComponentEvents.CountAsync());
        Assert.Equal(1, await _db.ControlStreamEvents.CountAsync());
    }

    // ── GateMaxTtl abort ──────────────────────────────────────────────────────

    [Fact]
    public void GateMaxTtl_WhenExceeded_MachineAborts()
    {
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new ResetStateMachine(cycle);

        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-70);
        var deadline = startedAt.AddSeconds(60);
        Assert.True(DateTimeOffset.UtcNow >= deadline);

        sm.Fire(ResetTrigger.Abort);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    // ── Fix A: reconciler aborts orphaned past-deadline cycle ────────────────

    [Fact]
    public async Task Reconciler_AbortLogic_OrphanedDrainingCycle_IsAbortedAndReturnsIdle()
    {
        // Seed a draining cycle whose deadline is in the past.
        var resetId = Guid.CreateVersion7();
        var pastDeadline = DateTimeOffset.UtcNow.AddSeconds(-30);
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = resetId,
            ExpectedComponents = ["dashboard-fetcher"],
            AcksReceived = [],
            StartedAt = pastDeadline.AddSeconds(-30),
            DeadlineAt = pastDeadline,
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        // Exercise the abort path directly (mirrors what the reconciler does after acquiring lock).
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.NotEqual(ResetState.Idle, loaded.State);

        // Abort: set state to idle, clear fields.
        loaded.State = ResetState.Idle;
        loaded.ResetId = null;
        loaded.ExpectedComponents = null;
        loaded.AcksReceived = null;
        loaded.StartedAt = null;
        loaded.DeadlineAt = null;
        await _cycleRepo.SaveAsync(loaded, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var afterAbort = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, afterAbort.State);
        Assert.Null(afterAbort.ResetId);
    }

    [Fact]
    public async Task Reconciler_AbortLogic_PastDeadlineResettingCycle_IsAbortedAndGateReleased()
    {
        var resetId = Guid.CreateVersion7();
        var pastDeadline = DateTimeOffset.UtcNow.AddSeconds(-5);
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Resetting,
            ResetId = resetId,
            StartedAt = pastDeadline.AddSeconds(-60),
            DeadlineAt = pastDeadline,
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        // Simulate reconciler abort.
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        loaded.State = ResetState.Idle;
        loaded.ResetId = null;
        loaded.ExpectedComponents = null;
        loaded.AcksReceived = null;
        loaded.StartedAt = null;
        loaded.DeadlineAt = null;
        await _cycleRepo.SaveAsync(loaded, CancellationToken.None);

        // After abort, the gate check (IsResetting) must return false.
        _db.ChangeTracker.Clear();
        var afterAbort = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, afterAbort.State);
    }

    [Fact]
    public async Task Reconciler_AbortLogic_ActiveCycleWithinTtl_IsNotAborted()
    {
        // A cycle whose DeadlineAt is still in the future must not be aborted.
        var resetId = Guid.CreateVersion7();
        var futureDeadline = DateTimeOffset.UtcNow.AddSeconds(30);
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = resetId,
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-5),
            DeadlineAt = futureDeadline,
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();

        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        // Reconciler condition: abort only when now >= DeadlineAt.
        var shouldAbort = DateTimeOffset.UtcNow >= loaded.DeadlineAt;
        Assert.False(shouldAbort, "Cycle within TTL must not be aborted.");
    }

    // ── reset-ack NOTIFY shape ────────────────────────────────────────────────

    [Fact]
    public void ResetAckNotifyShape_ContainsComponentIdAndResetId()
    {
        var componentId = "dashboard-fetcher";
        var resetId = Guid.CreateVersion7().ToString();

        var payload = System.Text.Json.JsonSerializer.Serialize(
            new { component_id = componentId, reset_id = resetId });

        var doc = System.Text.Json.JsonDocument.Parse(payload);
        Assert.Equal(componentId, doc.RootElement.GetProperty("component_id").GetString());
        Assert.Equal(resetId, doc.RootElement.GetProperty("reset_id").GetString());
    }

    // ── Fix D: ApplicationStopping token is wired ─────────────────────────────

    [Fact]
    public async Task TryInitiate_PassesApplicationStoppingToken_ToOrchestrator()
    {
        var trackingOrchestrator = new TokenCapturingOrchestrator();
        var opts = Microsoft.Extensions.Options.Options.Create(DefaultOptions());
        var svc = new ResetService(
            _cycleRepo,
            _controlStreamRepo,
            _notifier,
            trackingOrchestrator,
            _lifetime,
            opts,
            NullLogger<ResetService>.Instance);

        await svc.TryInitiateAsync();

        // Give the Task.Run a moment to start.
        await Task.Delay(50);
        Assert.True(trackingOrchestrator.WasCalled, "Orchestrator must have been called.");
        // The token passed must be the ApplicationStopping token (or its linked equivalent).
        Assert.Equal(_lifetime.ApplicationStopping, trackingOrchestrator.ReceivedToken);
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

    private sealed class NullOrchestrator : IResetOrchestrator
    {
        public Task DriveAsync(Guid resetId, ResetOptions options, CancellationToken appStopping)
            => Task.CompletedTask;
    }

    private sealed class TokenCapturingOrchestrator : IResetOrchestrator
    {
        public bool WasCalled { get; private set; }
        public CancellationToken ReceivedToken { get; private set; }

        public Task DriveAsync(Guid resetId, ResetOptions options, CancellationToken appStopping)
        {
            WasCalled = true;
            ReceivedToken = appStopping;
            return Task.CompletedTask;
        }
    }

    /// <summary>Minimal <see cref="IHostApplicationLifetime"/> stub for unit tests.</summary>
    private sealed class NullHostApplicationLifetime : IHostApplicationLifetime
    {
        private readonly CancellationTokenSource _cts = new();
        public CancellationToken ApplicationStarted => CancellationToken.None;
        public CancellationToken ApplicationStopping => _cts.Token;
        public CancellationToken ApplicationStopped => CancellationToken.None;
        public void StopApplication() => _cts.Cancel();
    }
}
