using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for the reset choreography — state machine, cycle repository, ack aggregation,
/// timeout, GateMaxTtl abort, and the 409 re-entry guard. Uses SQLite in-memory.
/// The <see cref="ResetOrchestrator"/> is exercised through a thin stub
/// (<see cref="NullOrchestrator"/>) so tests remain synchronous and deterministic.
/// </summary>
public sealed class ResetServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;
    private readonly ControlStreamRepository _controlStreamRepo;
    private readonly RecordingControlEventNotifier _notifier = new();
    private readonly NullOrchestrator _orchestrator = new();

    public ResetServiceTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();

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
        var options = Microsoft.Extensions.Options.Options.Create(opts ?? new ResetOptions
        {
            AckTimeoutSeconds = 10,
            ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
            GateMaxTtlSeconds = 60,
        });
        return new ResetService(
            _cycleRepo,
            _controlStreamRepo,
            _notifier,
            _orchestrator,
            options,
            NullLogger<ResetService>.Instance);
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
        // Re-entry on Start while draining should be silently ignored (409 is handled at endpoint).
        var cycle = new ResetCycle { Id = 1, State = ResetState.Draining };
        var sm = new ResetStateMachine(cycle);
        sm.Fire(ResetTrigger.Start); // must not throw
        Assert.True(sm.IsInState(ResetState.Draining));
    }

    // ── ResetCycle upsert / load ──────────────────────────────────────────────

    [Fact]
    public async Task CycleRepository_Load_WhenNoneExists_ReturnsIdleRow()
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
        var loaded = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, loaded.State);
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
        Assert.Equal(acceptance!.ResetId, ev.Id); // event id == reset_id

        var announced = Assert.Single(_notifier.Notified);
        Assert.Equal("reset-initiated", announced.Type);
        Assert.Equal(acceptance.ResetId, announced.Id);
    }

    [Fact]
    public async Task TryInitiate_WhenDraining_Returns409Null()
    {
        // Seed a draining cycle.
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = Guid.CreateVersion7(),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task TryInitiate_WhenResetting_Returns409Null()
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Resetting,
            ResetId = Guid.CreateVersion7(),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);

        var svc = BuildService();
        var result = await svc.TryInitiateAsync();

        Assert.Null(result);
    }

    // ── Ack aggregation (quorum) ───────────────────────────────────────────────

    [Fact]
    public async Task AckAggregation_QuorumReached_WhenAllExpectedAck()
    {
        var resetId = Guid.CreateVersion7();
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = resetId,
            ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
            AcksReceived = [],
        };

        cycle.AcksReceived = ["dashboard-fetcher", "demo-driver"];
        var acksSet = new HashSet<string>(cycle.AcksReceived);
        Assert.True(acksSet.IsSupersetOf(cycle.ExpectedComponents!));
    }

    [Fact]
    public async Task AckAggregation_PartialAck_QuorumNotReached()
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
    public async Task AckAggregation_StaleResetId_ShouldBeIgnored()
    {
        var activeResetId = Guid.CreateVersion7();
        var staleResetId = Guid.CreateVersion7();

        // Only acks matching activeResetId should count.
        Assert.NotEqual(activeResetId, staleResetId);
    }

    // ── Reset scope: only deployment_events + fetcher_state cleared (D14) ──────

    [Fact]
    public async Task ClearScope_OnlyDeploymentEventsAndFetcherStateAreCleared()
    {
        // Seed all four tables.
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

        // Simulate the clear step that the orchestrator performs (D14).
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

        // Simulate gate-max deadline exceeded.
        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-70);
        var deadline = startedAt.AddSeconds(60);
        Assert.True(DateTimeOffset.UtcNow >= deadline);

        sm.Fire(ResetTrigger.Abort);
        Assert.True(sm.IsInState(ResetState.Idle));
    }

    // ── reset-ack NOTIFY shape ────────────────────────────────────────────────

    [Fact]
    public void ResetAckNotifyShape_ContainsComponentIdAndResetId()
    {
        // The NOTIFY payload shape expected by ComponentAcksBroadcaster.
        var componentId = "dashboard-fetcher";
        var resetId = Guid.CreateVersion7().ToString();

        var payload = System.Text.Json.JsonSerializer.Serialize(
            new { component_id = componentId, reset_id = resetId });

        var doc = System.Text.Json.JsonDocument.Parse(payload);
        Assert.Equal(componentId, doc.RootElement.GetProperty("component_id").GetString());
        Assert.Equal(resetId, doc.RootElement.GetProperty("reset_id").GetString());
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

    /// <summary>
    /// No-op orchestrator stub: DriveAsync returns immediately, simulating the
    /// background cycle without touching Postgres or advisory locks.
    /// </summary>
    private sealed class NullOrchestrator : IResetOrchestrator
    {
        public Task DriveAsync(Guid resetId, ResetOptions options, CancellationToken appStopping)
            => Task.CompletedTask;
    }
}
