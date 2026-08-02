using System.Reflection;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.Sse;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="RecoverOrchestrator"/> — the non-destructive counterpart of
/// <see cref="ResetOrchestrator"/> (see <see cref="ResetOrchestratorTimeoutTests"/> for the
/// reset-side coverage this mirrors).
///
/// Covers:
/// <list type="number">
///   <item>The abort path (<see cref="RecoverOrchestrator.ExecuteAbortAsync"/>) emits
///     <c>recover-completed</c> carrying the resolved <c>{"since":"…"}</c> payload and
///     transitions the cycle to <c>idle</c>.</item>
///   <item>Abort clears the cycle row AND resets the <c>operation</c> discriminator back to
///     <c>"reset"</c> / <c>recover_since</c> back to <c>null</c> — the seeded baseline — so a
///     stale "recover" tag never lingers on the shared row.</item>
///   <item><b>Non-destructive:</b> deployment_events and fetcher_state, seeded before the
///     abort, are untouched by it — the negative-space counterpart of
///     <c>ResetServiceTests.ClearScope_OnlyDeploymentEventsAndFetcherStateAreCleared</c>.</item>
///   <item>The reconciler's operation-matched orphan-recovery emission
///     (<c>ResetReconciler.EmitOrphanRecoveryEventAsync</c>, private) emits
///     <c>recover-completed</c> with the since payload for a recover cycle and
///     <c>reset-completed</c> with no payload for a reset cycle — exercised via reflection
///     since it requires no Postgres advisory lock (that part of the reconciler is Postgres-only
///     and is covered by the deferred-to-CI Dashboard.Api.Tests reconciler suite).</item>
/// </list>
///
/// Advisory-lock acquisition itself is not exercised here (requires a real PostgreSQL
/// connection); that path — plus the full draining→resetting→idle happy path with real
/// <c>recover-started</c> emission — is covered by Dashboard.Api.Tests (deferred to CI: no
/// live Postgres in this sandbox). These tests use SQLite in-memory for all DB operations.
/// </summary>
public sealed class RecoverOrchestratorTimeoutTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;
    private readonly ControlStreamRepository _controlStreamRepo;
    private readonly RecordingControlEventNotifier _notifier = new();

    public RecoverOrchestratorTimeoutTests()
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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private RecoverOrchestrator BuildOrchestrator()
    {
        var services = new ServiceCollection()
            .AddDbContext<DashboardDbContext>(o => o.UseSqlite("DataSource=:memory:"))
            .AddSingleton<IControlStreamRepository>(_controlStreamRepo)
            .AddSingleton<IControlEventNotifier>(_notifier)
            .BuildServiceProvider();

        // These tests never open a Postgres connection; supply a dummy data source.
        var dataSource = NpgsqlDataSource.Create("Host=localhost");
        var broadcaster = new ComponentAcksBroadcaster(
            dataSource, NullLogger<ComponentAcksBroadcaster>.Instance);

        return new RecoverOrchestrator(
            services,
            broadcaster,
            NullLogger<RecoverOrchestrator>.Instance);
    }

    private async Task<ResetCycle> SeedCycleInStateAsync(
        string state, Guid correlationId, DateTimeOffset recoverSince)
    {
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);
        cycle.State = state;
        cycle.Operation = ControlOperation.Recover;
        cycle.CorrelationId = correlationId;
        cycle.ExpectedComponents = ["dashboard-fetcher", "demo-driver"];
        cycle.AcksReceived = [];
        cycle.StartedAt = DateTimeOffset.UtcNow.AddSeconds(-5);
        cycle.DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10);
        cycle.RecoverSince = recoverSince;
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();
        return cycle;
    }

    private static DeploymentEvent SampleEvent() => new()
    {
        Id = Guid.CreateVersion7(),
        DeploymentId = $"gh-{Guid.NewGuid():N}",
        Service = "recover-test-svc",
        Environment = "prod",
        Status = "success",
        HappenedAt = DateTimeOffset.UtcNow,
    };

    private static FetcherState SampleFetcherState() => new()
    {
        Adapter = "github-actions",
        Cursor = "opaque-cursor",
        UpdatedAt = DateTimeOffset.UtcNow,
    };

    // ── Abort emits recover-completed with the since payload (draining) ───────

    [Fact]
    public async Task AbortCycle_FromDraining_WritesIdleAndEmitsRecoverCompletedWithSincePayload()
    {
        var correlationId = Guid.CreateVersion7();
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var cycle = await SeedCycleInStateAsync(ResetState.Draining, correlationId, since);

        var orchestrator = BuildOrchestrator();
        await orchestrator.ExecuteAbortAsync(_db, cycle, _controlStreamRepo, _notifier, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var saved = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, saved.State);
        Assert.Null(saved.CorrelationId);

        var events = await _db.ControlStreamEvents.ToListAsync();
        var completed = Assert.Single(events);
        Assert.Equal("recover-completed", completed.Type);
        Assert.Equal("*", completed.Component);
        Assert.Equal(correlationId, completed.CorrelationId);
        Assert.Equal(RecoverPayload.Build(since), completed.Payload);

        var notified = Assert.Single(_notifier.Notified);
        Assert.Equal("recover-completed", notified.Type);
        Assert.Equal(correlationId, notified.CorrelationId);
    }

    [Fact]
    public async Task AbortCycle_FromResetting_WritesIdleAndEmitsRecoverCompleted()
    {
        var correlationId = Guid.CreateVersion7();
        var since = DateTimeOffset.UtcNow.AddDays(-2);
        var cycle = await SeedCycleInStateAsync(ResetState.Resetting, correlationId, since);

        var orchestrator = BuildOrchestrator();
        await orchestrator.ExecuteAbortAsync(_db, cycle, _controlStreamRepo, _notifier, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var saved = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, saved.State);

        var events = await _db.ControlStreamEvents.ToListAsync();
        var completed = Assert.Single(events);
        Assert.Equal("recover-completed", completed.Type);
        Assert.Equal(correlationId, completed.CorrelationId);
    }

    // ── Abort resets the operation discriminator + clears recover_since ───────

    [Fact]
    public async Task AbortCycle_ResetsOperationDiscriminatorToReset_AndClearsRecoverSince()
    {
        var correlationId = Guid.CreateVersion7();
        var since = DateTimeOffset.UtcNow.AddDays(-1);
        var cycle = await SeedCycleInStateAsync(ResetState.Draining, correlationId, since);

        var orchestrator = BuildOrchestrator();
        await orchestrator.ExecuteAbortAsync(_db, cycle, _controlStreamRepo, _notifier, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var saved = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ControlOperation.Reset, saved.Operation);
        Assert.Null(saved.RecoverSince);
        Assert.Null(saved.StartedAt);
        Assert.Null(saved.DeadlineAt);
        Assert.Null(saved.ExpectedComponents);
        Assert.Null(saved.AcksReceived);
    }

    // ── Non-destructive: seeded deployment/fetcher data survives the abort ────

    [Fact]
    public async Task AbortCycle_DoesNotClearDeploymentEventsOrFetcherState_NonDestructive()
    {
        _db.DeploymentEvents.Add(SampleEvent());
        _db.FetcherStates.Add(SampleFetcherState());
        await _db.SaveChangesAsync();

        var correlationId = Guid.CreateVersion7();
        var cycle = await SeedCycleInStateAsync(
            ResetState.Draining, correlationId, DateTimeOffset.UtcNow.AddDays(-1));

        var orchestrator = BuildOrchestrator();
        await orchestrator.ExecuteAbortAsync(_db, cycle, _controlStreamRepo, _notifier, CancellationToken.None);

        // Unlike the reset saga (D14: deployment_events + fetcher_state cleared), recover
        // clears NOTHING — both tables must be untouched.
        Assert.Equal(1, await _db.DeploymentEvents.CountAsync());
        Assert.Equal(1, await _db.FetcherStates.CountAsync());
    }

    // ── Reconciler: operation-matched orphan-recovery emission ────────────────
    //
    // ResetReconciler.EmitOrphanRecoveryEventAsync is `private static` and needs no Postgres
    // connection (only the repository/notifier it is handed) — invoked via reflection so the
    // operation-discriminated emission logic gets real coverage without a live advisory lock.

    private static async Task InvokeEmitOrphanRecoveryEventAsync(
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        Guid abortedId,
        string operation,
        DateTimeOffset? recoverSince,
        CancellationToken ct)
    {
        var method = typeof(ResetReconciler).GetMethod(
            "EmitOrphanRecoveryEventAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        var task = (Task)method.Invoke(
            null, [controlStream, notifier, abortedId, operation, recoverSince, ct])!;
        await task;
    }

    [Fact]
    public async Task ReconcilerOrphanEmission_ForRecoverOperation_EmitsRecoverCompletedWithSincePayload()
    {
        var correlationId = Guid.CreateVersion7();
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);

        await InvokeEmitOrphanRecoveryEventAsync(
            _controlStreamRepo, _notifier, correlationId, ControlOperation.Recover, since, CancellationToken.None);

        var events = await _db.ControlStreamEvents.ToListAsync();
        var ev = Assert.Single(events);
        Assert.Equal("recover-completed", ev.Type);
        Assert.Equal("*", ev.Component);
        Assert.Equal(correlationId, ev.CorrelationId);
        Assert.Equal(RecoverPayload.Build(since), ev.Payload);

        var notified = Assert.Single(_notifier.Notified);
        Assert.Equal("recover-completed", notified.Type);
    }

    [Fact]
    public async Task ReconcilerOrphanEmission_ForResetOperation_EmitsResetCompletedWithNullPayload()
    {
        var correlationId = Guid.CreateVersion7();

        await InvokeEmitOrphanRecoveryEventAsync(
            _controlStreamRepo, _notifier, correlationId, ControlOperation.Reset, null, CancellationToken.None);

        var events = await _db.ControlStreamEvents.ToListAsync();
        var ev = Assert.Single(events);
        Assert.Equal("reset-completed", ev.Type);
        Assert.Null(ev.Payload);
    }

    [Fact]
    public async Task ReconcilerOrphanEmission_AbortedIdEmpty_EmitsNothing()
    {
        // Guard clause: an empty correlation id (cycle had none) must not emit a phantom event.
        await InvokeEmitOrphanRecoveryEventAsync(
            _controlStreamRepo, _notifier, Guid.Empty, ControlOperation.Recover,
            DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Empty(await _db.ControlStreamEvents.ToListAsync());
        Assert.Empty(_notifier.Notified);
    }

    // ── Stubs ─────────────────────────────────────────────────────────────────

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

file class ServiceCollection
{
    private readonly List<(Type serviceType, object impl)> _registrations = [];

    public ServiceCollection AddDbContext<TContext>(Action<Microsoft.EntityFrameworkCore.DbContextOptionsBuilder> configure)
        where TContext : Microsoft.EntityFrameworkCore.DbContext
        => this; // Not used by ExecuteAbortAsync — omit for brevity.

    public ServiceCollection AddSingleton<TService>(TService implementation)
        where TService : class
    {
        _registrations.Add((typeof(TService), implementation));
        return this;
    }

    public IServiceProvider BuildServiceProvider() => new SimpleServiceProvider(_registrations);

    private sealed class SimpleServiceProvider(
        IReadOnlyList<(Type serviceType, object impl)> registrations) : IServiceProvider
    {
        public object? GetService(Type serviceType)
        {
            foreach (var (type, impl) in registrations)
                if (type == serviceType || serviceType.IsAssignableFrom(type))
                    return impl;
            return null;
        }
    }
}
