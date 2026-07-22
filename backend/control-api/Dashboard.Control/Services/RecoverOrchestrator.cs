using System.Diagnostics.CodeAnalysis;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Sse;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the recover choreography from <c>draining</c> through <c>resetting</c> back to
/// <c>idle</c> — the non-destructive counterpart of <see cref="ResetOrchestrator"/>. Runs on a
/// dedicated background thread started by <see cref="RecoverService.TryInitiateAsync"/> after
/// the endpoint returns <c>202</c>.
///
/// The operation-agnostic saga plumbing — advisory lock acquire/release
/// (<see cref="ChoreographyLock"/>), the wall-clock/timeout skeleton
/// (<see cref="ChoreographySagaRunner"/>), the ack-drain/wait loop
/// (<see cref="ChoreographyAckGate"/>), and cycle load/save/clear
/// (<see cref="ChoreographyCycleStore"/>, backed by <see cref="IResetCycleRepository"/>) — lives
/// in exactly one place, shared byte-for-byte with <see cref="ResetOrchestrator"/>. Sharing the
/// advisory lock key (<see cref="ResetCoordination"/>) makes reset and recover mutually exclusive
/// at the process level, on top of the single-flight row already enforcing it (Fix B).
///
/// <b>Non-destructive:</b> unlike <see cref="ResetOrchestrator"/>, no data-clearing phase runs —
/// deployment history and component state are preserved. The <c>resetting</c> phase here only
/// gates briefly while <c>recover-started</c> is emitted; the actual cursor rewind happens in the
/// fetcher, which reacts to <c>recover-completed</c>'s payload (<c>{"since":"…"}</c>).
///
/// On every state transition, emits <c>NOTIFY reset_state &lt;state&gt;</c> so all instances
/// update their cached ingest-gate flag without a DB round-trip (Fix C) — the gate flag is
/// operation-agnostic, so a brief recover cycle also gates ingest, mirroring reset.
/// </summary>
// S1200: an orchestrator necessarily touches every collaborator its choreography needs
// (repository, notifiers, broadcaster, state machine, DbContext) — coupling is inherent to
// the pattern, same rationale as ResetOrchestrator (which sits just under the threshold).
[SuppressMessage("SonarAnalyzer", "S1200", Justification = "Choreography driver: coupling to every collaborator the drive needs is inherent and irreducible.")]
internal sealed class RecoverOrchestrator(
    IServiceProvider services,
    ComponentAcksBroadcaster acksBroadcaster,
    ILogger<RecoverOrchestrator> logger) : IRecoverOrchestrator
{
    private ChoreographyIdentity Identity => new(logger, "Recover");

    public Task DriveAsync(Guid recoverId, ResetOptions options, CancellationToken appStopping) =>
        ChoreographySagaRunner.RunAsync(services, Identity, recoverId, options, appStopping, RunCycleAsync, TryAbortAsync);

    // ct is the linked token (appStopping ∪ processCts); it is cancelled when either the
    // application stops or GateMaxTtlSeconds elapses. Every await here observes it so a hung DB
    // call is interrupted rather than blocking indefinitely (D12, §9).
    private async Task RunCycleAsync(
        Guid recoverId,
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
        if (cycle.CorrelationId != recoverId)
        {
            logger.LogWarning("Recover orchestrator: correlation_id mismatch; expected {Expected}, got {Actual}. Aborting.",
                recoverId, cycle.CorrelationId);
            return;
        }

        var machine = new RecoverStateMachine(cycle);
        if (!machine.IsInState(ResetState.Draining))
        {
            logger.LogWarning("Recover orchestrator: cycle not in draining state; actual={State}. Aborting.", cycle.State);
            return;
        }

        var recoverSince = cycle.RecoverSince ?? DateTimeOffset.UtcNow;
        var deadlines = new ChoreographyDeadlines(
            cycle.DeadlineAt ?? DateTimeOffset.UtcNow.AddSeconds(options.AckTimeoutSeconds),
            (cycle.StartedAt ?? DateTimeOffset.UtcNow).AddSeconds(options.GateMaxTtlSeconds));

        await ChoreographyAckGate.WaitForAcksOrTimeoutAsync(acksBroadcaster, Identity, cycleCtx, cycle, deadlines, options, ct);

        // Check GateMaxTtl before proceeding to the gating phase.
        if (DateTimeOffset.UtcNow >= deadlines.GateMaxDeadline)
        {
            await AbortCycleAsync(cycleCtx, notifyCtx, cycle, ct);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        var correlationId = cycle.CorrelationId ?? recoverId;
        machine.Fire(RecoverTrigger.AcksIn);
        await TransitionToRewindingAsync(cycleCtx, notifyCtx, cycle, correlationId, ct);

        // Check GateMaxTtl before completing.
        if (DateTimeOffset.UtcNow >= deadlines.GateMaxDeadline)
        {
            await AbortCycleAsync(cycleCtx, notifyCtx, cycle, ct);
            return;
        }

        // ── Phase: resetting — non-destructive: NO data is cleared here (D14 does not apply). ──
        // The actual cursor rewind happens in the fetcher, which reacts to recover-completed's
        // payload below; the API's role is only to drive the shared gate/ack choreography.

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(RecoverTrigger.Complete);
        await TransitionToIdleAsync(cycleCtx, notifyCtx, cycle, correlationId, ct);

        logger.LogInformation("Recover orchestrator: recover {CorrelationId} completed (since={Since}).", correlationId, recoverSince);
    }

    // abortCt must be a non-cancelled token (appStopping or CancellationToken.None) so the
    // abort steps (DB write + NOTIFY) can complete even when processCts has already fired.
    private async Task AbortCycleAsync(
        ChoreographyCycleContext cycleCtx,
        ChoreographyNotifyContext notifyCtx,
        ResetCycle cycle,
        CancellationToken abortCt)
    {
        logger.LogWarning("Recover orchestrator: GateMaxTtl exceeded; aborting recover {CorrelationId}.", cycle.CorrelationId);

        var abortedRecoverId = cycle.CorrelationId ?? Guid.Empty;
        var recoverSince = cycle.RecoverSince;

        var machine = new RecoverStateMachine(cycle);
        if (!machine.IsInState(ResetState.Idle))
            machine.Fire(RecoverTrigger.Abort);

        // Correlation-guarded release: no-ops (0 rows) if a newer cycle has since superseded
        // this one on the shared row — see ChoreographyCycleStore.TryReleaseToIdleAsync.
        if (!await ChoreographyCycleStore.TryReleaseToIdleAsync(cycleCtx, cycle, abortedRecoverId, abortCt))
        {
            logger.LogDebug(
                "Recover orchestrator: abort no-op for {CorrelationId}; cycle was already superseded.",
                abortedRecoverId);
            return;
        }

        // Emit recover-completed so connected components (fetcher, demo-driver) can recover
        // via the control stream — mirrors the reconciler abort path.
        if (abortedRecoverId != Guid.Empty)
        {
            var completedEvent = ChoreographyEvents.Build(
                "recover-completed", abortedRecoverId, recoverSince is { } since ? RecoverPayload.Build(since) : null);
            await notifyCtx.ControlStream.InsertAsync(completedEvent, abortCt);
            await notifyCtx.Notifier.NotifyAsync(completedEvent, abortCt);
        }

        // Release the gate flag on all instances (Fix C).
        if (notifyCtx.StateNotifier is not null)
            await notifyCtx.StateNotifier.NotifyStateAsync(ResetState.Idle, abortCt);
    }

    private async Task TransitionToRewindingAsync(
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

        var recoverStartedEvent = ChoreographyEvents.Build("recover-started", correlationId);
        await notifyCtx.ControlStream.InsertAsync(recoverStartedEvent, ct);
        await notifyCtx.Notifier.NotifyAsync(recoverStartedEvent, ct);

        logger.LogInformation("Recover orchestrator: entered resetting phase for {CorrelationId}.", correlationId);
    }

    private async Task TransitionToIdleAsync(
        ChoreographyCycleContext cycleCtx,
        ChoreographyNotifyContext notifyCtx,
        ResetCycle cycle,
        Guid correlationId,
        CancellationToken ct)
    {
        // Captured before the release wipes it below.
        var recoverSince = cycle.RecoverSince ?? DateTimeOffset.UtcNow;

        // Correlation-guarded release: no-ops (0 rows) if a newer cycle has since superseded
        // this one on the shared row — see ChoreographyCycleStore.TryReleaseToIdleAsync.
        if (!await ChoreographyCycleStore.TryReleaseToIdleAsync(cycleCtx, cycle, correlationId, ct))
        {
            logger.LogDebug(
                "Recover orchestrator: idle transition no-op for {CorrelationId}; cycle was already superseded.",
                correlationId);
            return;
        }

        // Notify all instances that the gate is now OFF (Fix C).
        if (notifyCtx.StateNotifier is not null)
            await notifyCtx.StateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        var recoverCompletedEvent = ChoreographyEvents.Build("recover-completed", correlationId, RecoverPayload.Build(recoverSince));
        await notifyCtx.ControlStream.InsertAsync(recoverCompletedEvent, ct);
        await notifyCtx.Notifier.NotifyAsync(recoverCompletedEvent, ct);
    }

    // Fallback abort for unhandled exceptions. recoverId hint is used if the cycle row has
    // already been cleared or is mismatched. Uses appStopping (non-cancelled) for all IO.
    private async Task TryAbortAsync(Guid recoverId, CancellationToken appStopping)
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
            else if (recoverId != Guid.Empty)
            {
                // Cycle already idle (may have been cleaned up), but still emit recover-completed
                // so any components still waiting on the stream can recover. No resolved `since`
                // is available in this fallback branch (cycle was already cleared).
                var completedEvent = ChoreographyEvents.Build("recover-completed", recoverId);
                await notifyCtx.ControlStream.InsertAsync(completedEvent, appStopping);
                await notifyCtx.Notifier.NotifyAsync(completedEvent, appStopping);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Recover orchestrator: error during abort.");
        }
    }

    // ── Internal testing seam ─────────────────────────────────────────────────

    /// <summary>
    /// Executes the abort path (write idle state + emit recover-completed + NOTIFY) using the
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
}
