using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Sse;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the reset choreography state machine from <c>draining</c> through <c>resetting</c>
/// back to <c>idle</c>. Runs on a dedicated background thread started by
/// <see cref="ResetService.TryInitiateAsync"/> after the endpoint returns <c>202</c>.
///
/// The operation-agnostic saga plumbing — advisory lock acquire/release
/// (<see cref="ChoreographyLock"/>), the wall-clock/timeout skeleton
/// (<see cref="ChoreographySagaRunner"/>), the ack-drain/wait loop
/// (<see cref="ChoreographyAckGate"/>), and cycle load/save/clear
/// (<see cref="ChoreographyCycleStore"/>, backed by <see cref="IResetCycleRepository"/>) — lives
/// in exactly one place, shared byte-for-byte with <see cref="RecoverOrchestrator"/>. This class
/// supplies only the operation-specific step (D14: clear <c>deployment_events</c> +
/// <c>fetcher_state</c>) and the <c>reset-*</c> event-type/payload shape (no payload, unlike
/// recover's resolved <c>since</c>).
///
/// On every state transition, emits <c>NOTIFY reset_state &lt;state&gt;</c> so all instances
/// update their cached ingest-gate flag without a DB round-trip (Fix C).
/// </summary>
internal sealed class ResetOrchestrator(
    IServiceProvider services,
    ComponentAcksBroadcaster acksBroadcaster,
    ILogger<ResetOrchestrator> logger) : IResetOrchestrator
{
    private ChoreographyIdentity Identity => new(logger, "Reset");

    public Task DriveAsync(Guid resetId, ResetOptions options, CancellationToken appStopping) =>
        ChoreographySagaRunner.RunAsync(services, Identity, resetId, options, appStopping, RunCycleAsync, TryAbortAsync);

    // ct is the linked token (appStopping ∪ processCts); it is cancelled when either the
    // application stops or GateMaxTtlSeconds elapses.  Every await here observes it so a
    // hung DB call is interrupted rather than blocking indefinitely (D12, §9).
    private async Task RunCycleAsync(
        Guid resetId,
        ResetOptions options,
        CancellationToken ct)
    {
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var cycleCtx = new ChoreographyCycleContext(
            sp.GetRequiredService<DashboardDbContext>(), sp.GetRequiredService<IResetCycleRepository>());
        var notifyCtx = new ChoreographyNotifyContext(
            sp.GetRequiredService<IControlStreamRepository>(),
            sp.GetRequiredService<IControlEventNotifier>(),
            sp.GetService<IResetStateNotifier>());

        // ── Phase: draining — wait for acks or AckTimeout ────────────────────
        var cycle = await ChoreographyCycleStore.LoadAsync(cycleCtx, ct);
        if (cycle.CorrelationId != resetId)
        {
            logger.LogWarning("Reset orchestrator: correlation_id mismatch; expected {Expected}, got {Actual}. Aborting.",
                resetId, cycle.CorrelationId);
            return;
        }

        var machine = new ResetStateMachine(cycle);
        if (!machine.IsInState(ResetState.Draining))
        {
            logger.LogWarning("Reset orchestrator: cycle not in draining state; actual={State}. Aborting.", cycle.State);
            return;
        }

        var deadlines = new ChoreographyDeadlines(
            cycle.DeadlineAt ?? DateTimeOffset.UtcNow.AddSeconds(options.AckTimeoutSeconds),
            (cycle.StartedAt ?? DateTimeOffset.UtcNow).AddSeconds(options.GateMaxTtlSeconds));

        await ChoreographyAckGate.WaitForAcksOrTimeoutAsync(acksBroadcaster, Identity, cycleCtx, cycle, deadlines, options, ct);

        // Check GateMaxTtl before proceeding to resetting.
        if (DateTimeOffset.UtcNow >= deadlines.GateMaxDeadline)
        {
            await AbortCycleAsync(cycleCtx, notifyCtx, cycle, ct);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        var correlationId = cycle.CorrelationId ?? resetId;
        machine.Fire(ResetTrigger.AcksIn);
        await TransitionToResettingAsync(cycleCtx, notifyCtx, cycle, correlationId, ct);

        // Check GateMaxTtl before clearing.
        if (DateTimeOffset.UtcNow >= deadlines.GateMaxDeadline)
        {
            await AbortCycleAsync(cycleCtx, notifyCtx, cycle, ct);
            return;
        }

        // ── Phase: resetting — clear data ─────────────────────────────────────
        await ClearDataTablesAsync(cycleCtx.Db, ct);
        logger.LogInformation("Reset orchestrator: data cleared for reset {ResetId}.", resetId);

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(ResetTrigger.Complete);
        await TransitionToIdleAsync(cycleCtx, notifyCtx, cycle, correlationId, ct);

        logger.LogInformation("Reset orchestrator: reset {CorrelationId} completed.", correlationId);
    }

    // abortCt must be a non-cancelled token (appStopping or CancellationToken.None) so the
    // abort steps (DB write + NOTIFY) can complete even when processCts has already fired.
    private async Task AbortCycleAsync(
        ChoreographyCycleContext cycleCtx,
        ChoreographyNotifyContext notifyCtx,
        ResetCycle cycle,
        CancellationToken abortCt)
    {
        logger.LogWarning("Reset orchestrator: GateMaxTtl exceeded; aborting reset {CorrelationId}.", cycle.CorrelationId);

        var abortedResetId = cycle.CorrelationId ?? Guid.Empty;

        var machine = new ResetStateMachine(cycle);
        if (!machine.IsInState(ResetState.Idle))
            machine.Fire(ResetTrigger.Abort);

        // Correlation-guarded release: no-ops (0 rows) if a newer cycle has since superseded
        // this one on the shared row — see ChoreographyCycleStore.TryReleaseToIdleAsync.
        if (!await ChoreographyCycleStore.TryReleaseToIdleAsync(cycleCtx, cycle, abortedResetId, abortCt))
        {
            logger.LogDebug(
                "Reset orchestrator: abort no-op for {CorrelationId}; cycle was already superseded.",
                abortedResetId);
            return;
        }

        // Emit reset-completed so connected components (fetcher, demo-driver) can recover
        // via the control stream — mirrors the reconciler abort path.
        if (abortedResetId != Guid.Empty)
        {
            var completedEvent = ChoreographyEvents.Build("reset-completed", abortedResetId);
            await notifyCtx.ControlStream.InsertAsync(completedEvent, abortCt);
            await notifyCtx.Notifier.NotifyAsync(completedEvent, abortCt);
        }

        // Release the gate flag on all instances (Fix C).
        if (notifyCtx.StateNotifier is not null)
            await notifyCtx.StateNotifier.NotifyStateAsync(ResetState.Idle, abortCt);
    }

    private async Task TransitionToResettingAsync(
        ChoreographyCycleContext cycleCtx,
        ChoreographyNotifyContext notifyCtx,
        ResetCycle cycle,
        Guid correlationId,
        CancellationToken ct)
    {
        await ChoreographyCycleStore.SaveAsync(cycleCtx, cycle, ct);

        // Notify all instances that the gate is now ON (Fix C).
        if (notifyCtx.StateNotifier is not null)
            await notifyCtx.StateNotifier.NotifyStateAsync(ResetState.Resetting, ct);

        var resetStartedEvent = ChoreographyEvents.Build("reset-started", correlationId);
        await notifyCtx.ControlStream.InsertAsync(resetStartedEvent, ct);
        await notifyCtx.Notifier.NotifyAsync(resetStartedEvent, ct);

        logger.LogInformation("Reset orchestrator: entered resetting phase for {CorrelationId}.", correlationId);
    }

    private async Task TransitionToIdleAsync(
        ChoreographyCycleContext cycleCtx,
        ChoreographyNotifyContext notifyCtx,
        ResetCycle cycle,
        Guid correlationId,
        CancellationToken ct)
    {
        // Correlation-guarded release: no-ops (0 rows) if a newer cycle has since superseded
        // this one on the shared row — see ChoreographyCycleStore.TryReleaseToIdleAsync.
        if (!await ChoreographyCycleStore.TryReleaseToIdleAsync(cycleCtx, cycle, correlationId, ct))
        {
            logger.LogDebug(
                "Reset orchestrator: idle transition no-op for {CorrelationId}; cycle was already superseded.",
                correlationId);
            return;
        }

        // Notify all instances that the gate is now OFF (Fix C).
        if (notifyCtx.StateNotifier is not null)
            await notifyCtx.StateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        var resetCompletedEvent = ChoreographyEvents.Build("reset-completed", correlationId);
        await notifyCtx.ControlStream.InsertAsync(resetCompletedEvent, ct);
        await notifyCtx.Notifier.NotifyAsync(resetCompletedEvent, ct);
    }

    // Fallback abort for unhandled exceptions.  resetId hint is used if the cycle row has
    // already been cleared or is mismatched.  Uses appStopping (non-cancelled) for all IO.
    private async Task TryAbortAsync(Guid resetId, CancellationToken appStopping)
    {
        try
        {
            await using var abortScope = services.CreateAsyncScope();
            var sp = abortScope.ServiceProvider;
            var cycleCtx = new ChoreographyCycleContext(
                sp.GetRequiredService<DashboardDbContext>(), sp.GetRequiredService<IResetCycleRepository>());
            var notifyCtx = new ChoreographyNotifyContext(
                sp.GetRequiredService<IControlStreamRepository>(),
                sp.GetRequiredService<IControlEventNotifier>(),
                sp.GetService<IResetStateNotifier>());
            var cycle = await ChoreographyCycleStore.LoadAsync(cycleCtx, appStopping);
            if (cycle.State != ResetState.Idle)
            {
                await AbortCycleAsync(cycleCtx, notifyCtx, cycle, appStopping);
            }
            else if (resetId != Guid.Empty)
            {
                // Cycle already idle (may have been cleaned up), but still emit reset-completed
                // so any components still waiting on the stream can recover.
                var completedEvent = ChoreographyEvents.Build("reset-completed", resetId);
                await notifyCtx.ControlStream.InsertAsync(completedEvent, appStopping);
                await notifyCtx.Notifier.NotifyAsync(completedEvent, appStopping);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Reset orchestrator: error during abort.");
        }
    }

    // ── Internal testing seam ─────────────────────────────────────────────────

    /// <summary>
    /// Executes the abort path (write idle state + emit reset-completed + NOTIFY) using the
    /// supplied dependencies. Exposed as <c>internal</c> so <c>Dashboard.Control.Tests</c> can
    /// drive the abort flow with an in-memory SQLite store and a recording notifier without
    /// requiring a real Postgres advisory lock. Production callers use <see cref="TryAbortAsync"/>.
    /// The repository is constructed directly (rather than resolved from a DI scope) because this
    /// seam is invoked outside of any scope — it is a thin, dependency-free wrapper over
    /// <paramref name="db"/> (see <see cref="ResetCycleRepository"/>).
    /// </summary>
    internal async Task ExecuteAbortAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        CancellationToken ct)
        => await AbortCycleAsync(
            new ChoreographyCycleContext(db, new ResetCycleRepository(db)),
            new ChoreographyNotifyContext(controlStream, notifier, StateNotifier: null),
            cycle,
            ct);

    // ── Data clearing (D14: only deployment_events + fetcher_state) ───────────

    private static async Task ClearDataTablesAsync(DashboardDbContext db, CancellationToken ct)
    {
        await db.DeploymentEvents.ExecuteDeleteAsync(ct);
        await db.FetcherStates.ExecuteDeleteAsync(ct);
    }
}
