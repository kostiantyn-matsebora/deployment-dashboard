using System.Diagnostics.CodeAnalysis;
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
using Npgsql;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the recover choreography from <c>draining</c> through <c>resetting</c> back to
/// <c>idle</c> — the non-destructive counterpart of <see cref="ResetOrchestrator"/>. Runs on a
/// dedicated background thread started by <see cref="RecoverService.TryInitiateAsync"/> after
/// the endpoint returns <c>202</c>.
///
/// Shares reset's advisory lock (fixed key <c>7654321</c>, see <see cref="ResetCoordination"/>)
/// held on a <b>dedicated, always-open</b> Npgsql connection for the duration of the cycle —
/// session-level lock semantics require the Postgres session to stay alive (D12, NFR-05). This
/// makes reset and recover mutually exclusive at the process level, on top of the single-flight
/// row already enforcing it (Fix B).
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
    public async Task DriveAsync(
        Guid recoverId,
        ResetOptions options,
        CancellationToken appStopping)
    {
        var lockConn = await TryOpenAndAcquireLockAsync(appStopping);
        if (lockConn is null)
            return;

        logger.LogInformation("Recover orchestrator: advisory lock acquired for recover {RecoverId}.", recoverId);

        // Hard wall-clock ceiling on the entire cycle. If any await inside the cycle hangs past
        // GateMaxTtlSeconds the linked token fires, the catch below force-aborts with a
        // non-cancelled token, and the finally releases the advisory lock — guaranteeing the
        // system is never wedged longer than GateMaxTtlSeconds (D12, §9).
        await using var _ = lockConn;
        using var processCts = new CancellationTokenSource(
            TimeSpan.FromSeconds(options.GateMaxTtlSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            appStopping, processCts.Token);

        try
        {
            await RunCycleAsync(recoverId, options, linkedCts.Token);
        }
        catch (OperationCanceledException) when (
            processCts.IsCancellationRequested && !appStopping.IsCancellationRequested)
        {
            // Wall-clock timeout fired — not a graceful shutdown. Force the cycle back to idle
            // and emit recover-completed so components can recover.
            logger.LogWarning(
                "Recover orchestrator: GateMaxTtlSeconds ({Ttl}s) wall-clock ceiling reached; " +
                "force-aborting recover {RecoverId}.",
                options.GateMaxTtlSeconds, recoverId);
            await TryAbortAsync(recoverId, appStopping);
        }
        catch (Exception ex) when (!appStopping.IsCancellationRequested)
        {
            logger.LogError(ex, "Recover orchestrator: unhandled error; forcing abort for recover {RecoverId}.", recoverId);
            await TryAbortAsync(recoverId, appStopping);
        }
        finally
        {
            await ReleaseAdvisoryLockAsync(lockConn, appStopping);
            logger.LogInformation("Recover orchestrator: advisory lock released for recover {RecoverId}.", recoverId);
        }
    }

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
        var db = sp.GetRequiredService<DashboardDbContext>();
        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();
        var stateNotifier = sp.GetService<IResetStateNotifier>();

        // ── Phase: draining — wait for acks or AckTimeout ────────────────────
        var cycle = await LoadCycleAsync(db, ct);
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
        var ackDeadline = cycle.DeadlineAt ?? DateTimeOffset.UtcNow.AddSeconds(options.AckTimeoutSeconds);
        var gateMaxDeadline = (cycle.StartedAt ?? DateTimeOffset.UtcNow).AddSeconds(options.GateMaxTtlSeconds);

        await WaitForAcksOrTimeoutAsync(db, cycle, ackDeadline, gateMaxDeadline, options, ct);

        // Check GateMaxTtl before proceeding to the gating phase.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier, ct);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        var correlationId = cycle.CorrelationId ?? recoverId;
        machine.Fire(RecoverTrigger.AcksIn);
        await TransitionToRewindingAsync(db, cycle, controlStream, notifier, stateNotifier, correlationId, ct);

        // Check GateMaxTtl before completing.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier, ct);
            return;
        }

        // ── Phase: resetting — non-destructive: NO data is cleared here (D14 does not apply). ──
        // The actual cursor rewind happens in the fetcher, which reacts to recover-completed's
        // payload below; the API's role is only to drive the shared gate/ack choreography.

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(RecoverTrigger.Complete);
        await TransitionToIdleAsync(db, cycle, controlStream, notifier, stateNotifier, correlationId, ct);

        logger.LogInformation("Recover orchestrator: recover {CorrelationId} completed (since={Since}).", correlationId, recoverSince);
    }

    // ct is the linked token (appStopping ∪ processCts) passed down from RunCycleAsync.
    // The inner ack-wait creates its own sub-deadline capped at min(ackDeadline, gateMaxDeadline).
    private async Task WaitForAcksOrTimeoutAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        DateTimeOffset ackDeadline,
        DateTimeOffset gateMaxDeadline,
        ResetOptions options,
        CancellationToken ct)
    {
        var expectedComponents = cycle.ExpectedComponents ?? options.ExpectedComponents;
        var acksReceived = new HashSet<string>(cycle.AcksReceived ?? [], StringComparer.Ordinal);

        if (acksReceived.IsSupersetOf(expectedComponents))
            return;

        var ackWait = TimeSpan.FromMilliseconds(
            Math.Max(0, (ackDeadline - DateTimeOffset.UtcNow).TotalMilliseconds));
        var gateWait = TimeSpan.FromMilliseconds(
            Math.Max(0, (gateMaxDeadline - DateTimeOffset.UtcNow).TotalMilliseconds));
        var waitCap = ackWait < gateWait ? ackWait : gateWait;

        using var timeoutCts = new CancellationTokenSource(waitCap);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            while (await acksBroadcaster.AckReader.WaitToReadAsync(linked.Token))
            {
                if (await DrainAckBatchAsync(db, cycle, acksReceived, expectedComponents, ct))
                    return;
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Inner ack-wait timeout elapsed; proceed with however many acks arrived.
            logger.LogInformation(
                "Recover orchestrator: ack timeout elapsed for correlation_id {CorrelationId}; proceeding with {Count}/{Total} acks.",
                cycle.CorrelationId, acksReceived.Count, expectedComponents.Length);
        }
    }

    // abortCt must be a non-cancelled token (appStopping or CancellationToken.None) so the
    // abort steps (DB write + NOTIFY) can complete even when processCts has already fired.
    private async Task AbortCycleAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        IResetStateNotifier? stateNotifier,
        CancellationToken abortCt)
    {
        logger.LogWarning("Recover orchestrator: GateMaxTtl exceeded; aborting recover {CorrelationId}.", cycle.CorrelationId);

        var abortedRecoverId = cycle.CorrelationId ?? Guid.Empty;
        var recoverSince = cycle.RecoverSince;

        var machine = new RecoverStateMachine(cycle);
        if (!machine.IsInState(ResetState.Idle))
            machine.Fire(RecoverTrigger.Abort);
        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, abortCt);

        // Emit recover-completed so connected components (fetcher, demo-driver) can recover
        // via the control stream — mirrors the reconciler abort path.
        if (abortedRecoverId != Guid.Empty)
        {
            var completedEvent = BuildControlEvent(
                "recover-completed", abortedRecoverId, recoverSince is { } since ? RecoverPayload.Build(since) : null);
            await controlStream.InsertAsync(completedEvent, abortCt);
            await notifier.NotifyAsync(completedEvent, abortCt);
        }

        // Release the gate flag on all instances (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, abortCt);
    }

    private async Task TransitionToRewindingAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        IResetStateNotifier? stateNotifier,
        Guid correlationId,
        CancellationToken ct)
    {
        await SaveCycleAsync(db, cycle, ct);

        // Notify all instances that the gate is now ON (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Resetting, ct);

        var recoverStartedEvent = BuildControlEvent("recover-started", correlationId, payload: null);
        await controlStream.InsertAsync(recoverStartedEvent, ct);
        await notifier.NotifyAsync(recoverStartedEvent, ct);

        logger.LogInformation("Recover orchestrator: entered resetting phase for {CorrelationId}.", correlationId);
    }

    private async Task TransitionToIdleAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        IResetStateNotifier? stateNotifier,
        Guid correlationId,
        CancellationToken ct)
    {
        // Captured before ClearCycleFields wipes it below.
        var recoverSince = cycle.RecoverSince ?? DateTimeOffset.UtcNow;

        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, ct);

        // Notify all instances that the gate is now OFF (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        var recoverCompletedEvent = BuildControlEvent("recover-completed", correlationId, RecoverPayload.Build(recoverSince));
        await controlStream.InsertAsync(recoverCompletedEvent, ct);
        await notifier.NotifyAsync(recoverCompletedEvent, ct);
    }

    /// <summary>
    /// Drains all pending acks from <see cref="ComponentAcksBroadcaster.AckReader"/> into
    /// <paramref name="acksReceived"/>, persists the cycle after each new ack, and returns
    /// <c>true</c> once all expected components have acknowledged.
    /// </summary>
    private async Task<bool> DrainAckBatchAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        HashSet<string> acksReceived,
        string[] expectedComponents,
        CancellationToken ct)
    {
        while (acksBroadcaster.AckReader.TryRead(out var ack))
        {
            if (!Guid.TryParse(ack.CorrelationId, out var ackCorrelationId) || ackCorrelationId != cycle.CorrelationId)
                continue;

            if (acksReceived.Add(ack.ComponentId))
            {
                cycle.AcksReceived = [.. acksReceived];
                await SaveCycleAsync(db, cycle, ct);
                logger.LogInformation(
                    "Recover orchestrator: ack received from {ComponentId} ({Count}/{Total}).",
                    ack.ComponentId, acksReceived.Count, expectedComponents.Length);
            }

            if (acksReceived.IsSupersetOf(expectedComponents))
                return true;
        }

        return false;
    }

    // Fallback abort for unhandled exceptions. recoverId hint is used if the cycle row has
    // already been cleared or is mismatched. Uses appStopping (non-cancelled) for all IO.
    private async Task TryAbortAsync(Guid recoverId, CancellationToken appStopping)
    {
        try
        {
            await using var abortScope = services.CreateAsyncScope();
            var sp = abortScope.ServiceProvider;
            var abortDb = sp.GetRequiredService<DashboardDbContext>();
            var controlStream = sp.GetRequiredService<IControlStreamRepository>();
            var notifier = sp.GetRequiredService<IControlEventNotifier>();
            var stateNotifier = sp.GetService<IResetStateNotifier>();
            var cycle = await LoadCycleAsync(abortDb, appStopping);
            if (cycle.State != ResetState.Idle)
            {
                await AbortCycleAsync(abortDb, cycle, controlStream, notifier, stateNotifier, appStopping);
            }
            else if (recoverId != Guid.Empty)
            {
                // Cycle already idle (may have been cleaned up), but still emit recover-completed
                // so any components still waiting on the stream can recover. No resolved `since`
                // is available in this fallback branch (cycle was already cleared).
                var completedEvent = BuildControlEvent("recover-completed", recoverId, payload: null);
                await controlStream.InsertAsync(completedEvent, appStopping);
                await notifier.NotifyAsync(completedEvent, appStopping);
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
    /// </summary>
    internal async Task ExecuteAbortAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        CancellationToken ct)
        => await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier: null, ct);

    // ── Advisory lock helpers ─────────────────────────────────────────────────

    private static async Task<bool> TryAcquireAdvisoryLockAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"SELECT pg_try_advisory_lock({ResetCoordination.AdvisoryLockKey})", conn);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is true;
    }

    /// <summary>
    /// Opens a dedicated Postgres connection and attempts to acquire the advisory lock.
    /// Returns <c>null</c> when the connection string is missing, the lock is held by
    /// another instance (e.g. a reset already driving), or the lock query fails; the caller
    /// should return without driving. Returns the open connection (non-null) only when the
    /// lock is held.
    /// </summary>
    private async Task<NpgsqlConnection?> TryOpenAndAcquireLockAsync(CancellationToken ct)
    {
        var dataSource = services.GetService<NpgsqlDataSource>();

        if (dataSource is null)
        {
            logger.LogWarning("Recover orchestrator: NpgsqlDataSource not available; skipping.");
            return null;
        }

        var lockConn = dataSource.CreateConnection();
        await lockConn.OpenAsync(ct);

        bool lockAcquired;
        try
        {
            lockAcquired = await TryAcquireAdvisoryLockAsync(lockConn, ct);
        }
        catch (Exception ex)
        {
            await lockConn.DisposeAsync();
            logger.LogError(ex, "Recover orchestrator: failed to acquire advisory lock.");
            return null;
        }

        if (!lockAcquired)
        {
            await lockConn.DisposeAsync();
            logger.LogInformation("Recover orchestrator: advisory lock held by another instance; yielding.");
            return null;
        }

        return lockConn;
    }

    private static async Task ReleaseAdvisoryLockAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(
                $"SELECT pg_advisory_unlock({ResetCoordination.AdvisoryLockKey})", conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch { /* Best-effort: connection may already be closed. */ }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static async Task<ResetCycle> LoadCycleAsync(DashboardDbContext db, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        return await db.ResetCycles.FindAsync([(short)1], ct)
               ?? new ResetCycle { Id = 1, State = ResetState.Idle };
    }

    private static async Task SaveCycleAsync(DashboardDbContext db, ResetCycle cycle, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var existing = await db.ResetCycles.FindAsync([(short)1], ct);
        if (existing is null)
        {
            db.ResetCycles.Add(cycle);
        }
        else
        {
            existing.State = cycle.State;
            existing.CorrelationId = cycle.CorrelationId;
            existing.ExpectedComponents = cycle.ExpectedComponents;
            existing.AcksReceived = cycle.AcksReceived;
            existing.StartedAt = cycle.StartedAt;
            existing.DeadlineAt = cycle.DeadlineAt;
            existing.Operation = cycle.Operation;
            existing.RecoverSince = cycle.RecoverSince;
        }

        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }

    private static ControlStreamEvent BuildControlEvent(string type, Guid correlationId, string? payload) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = type,
            Component = "*",
            CorrelationId = correlationId,
            OccurredAt = DateTimeOffset.UtcNow,
            Payload = payload,
        };

    // Returns the cycle to the seeded baseline (operation="reset", recover_since=null) so a
    // stale "recover" tag never lingers on the shared row once idle — the next claim (reset or
    // recover) always overwrites both explicitly anyway (Repository.TryClaimIdleAsync), but this
    // keeps the idle row's on-disk state matching the documented baseline.
    private static void ClearCycleFields(ResetCycle cycle)
    {
        cycle.State = ResetState.Idle;
        cycle.CorrelationId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
        cycle.Operation = ControlOperation.Reset;
        cycle.RecoverSince = null;
    }
}
