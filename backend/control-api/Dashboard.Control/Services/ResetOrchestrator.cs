using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.Sse;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the reset choreography state machine from <c>draining</c> through <c>resetting</c>
/// back to <c>idle</c>. Runs on a dedicated background thread started by
/// <see cref="ResetService.TryInitiateAsync"/> after the endpoint returns <c>202</c>.
///
/// Advisory lock (fixed key <c>7654321</c>) is held on a <b>dedicated, always-open</b>
/// Npgsql connection for the duration of the cycle — session-level lock semantics require
/// the Postgres session to stay alive (D12, NFR-05).
///
/// On every state transition, emits <c>NOTIFY reset_state &lt;state&gt;</c> so all instances
/// update their cached ingest-gate flag without a DB round-trip (Fix C).
/// </summary>
internal sealed class ResetOrchestrator(
    IServiceProvider services,
    ComponentAcksBroadcaster acksBroadcaster,
    ILogger<ResetOrchestrator> logger) : IResetOrchestrator
{
    public async Task DriveAsync(
        Guid resetId,
        ResetOptions options,
        CancellationToken appStopping)
    {
        var connectionString = services.GetService<IConfiguration>()
            ?.GetConnectionString(ResetCoordination.PostgresConnectionName);

        if (string.IsNullOrEmpty(connectionString))
        {
            logger.LogWarning("Reset orchestrator: Postgres connection string not available; skipping.");
            return;
        }

        await using var lockConn = new NpgsqlConnection(connectionString);
        await lockConn.OpenAsync(appStopping);

        bool lockAcquired;
        try
        {
            lockAcquired = await TryAcquireAdvisoryLockAsync(lockConn, appStopping);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Reset orchestrator: failed to acquire advisory lock.");
            return;
        }

        if (!lockAcquired)
        {
            logger.LogInformation("Reset orchestrator: advisory lock held by another instance; yielding.");
            return;
        }

        logger.LogInformation("Reset orchestrator: advisory lock acquired for reset {ResetId}.", resetId);

        // Hard wall-clock ceiling on the entire cycle.  If any await inside the cycle
        // (including ClearDataTablesAsync) hangs past GateMaxTtlSeconds the linked token
        // fires, the catch below force-aborts with a non-cancelled token, and the finally
        // releases the advisory lock — guaranteeing the system is never wedged longer than
        // GateMaxTtlSeconds (D12, §9).
        using var processCts = new CancellationTokenSource(
            TimeSpan.FromSeconds(options.GateMaxTtlSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(
            appStopping, processCts.Token);

        try
        {
            await RunCycleAsync(resetId, options, linkedCts.Token);
        }
        catch (OperationCanceledException) when (
            processCts.IsCancellationRequested && !appStopping.IsCancellationRequested)
        {
            // Wall-clock timeout fired — not a graceful shutdown.  Force the cycle back to
            // idle and emit reset-completed so components can recover.
            logger.LogWarning(
                "Reset orchestrator: GateMaxTtlSeconds ({Ttl}s) wall-clock ceiling reached; " +
                "force-aborting reset {ResetId}.",
                options.GateMaxTtlSeconds, resetId);
            await TryAbortAsync(resetId, appStopping);
        }
        catch (Exception ex) when (!appStopping.IsCancellationRequested)
        {
            logger.LogError(ex, "Reset orchestrator: unhandled error; forcing abort for reset {ResetId}.", resetId);
            await TryAbortAsync(resetId, appStopping);
        }
        finally
        {
            await ReleaseAdvisoryLockAsync(lockConn, appStopping);
            logger.LogInformation("Reset orchestrator: advisory lock released for reset {ResetId}.", resetId);
        }
    }

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
        var db = sp.GetRequiredService<DashboardDbContext>();
        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();
        var stateNotifier = sp.GetService<IResetStateNotifier>();

        // ── Phase: draining — wait for acks or AckTimeout ────────────────────
        var cycle = await LoadCycleAsync(db, ct);
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

        var ackDeadline = cycle.DeadlineAt ?? DateTimeOffset.UtcNow.AddSeconds(options.AckTimeoutSeconds);
        var gateMaxDeadline = (cycle.StartedAt ?? DateTimeOffset.UtcNow).AddSeconds(options.GateMaxTtlSeconds);

        await WaitForAcksOrTimeoutAsync(db, cycle, ackDeadline, gateMaxDeadline, options, ct);

        // Check GateMaxTtl before proceeding to resetting.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier, ct);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        machine.Fire(ResetTrigger.AcksIn);
        await SaveCycleAsync(db, cycle, ct);

        // Notify all instances that the gate is now ON (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Resetting, ct);

        var correlationId = cycle.CorrelationId ?? resetId;
        var resetStartedEvent = ResetCoordination.BuildControlEvent(ResetCoordination.EventResetStarted, correlationId);
        await controlStream.InsertAsync(resetStartedEvent, ct);
        await notifier.NotifyAsync(resetStartedEvent, ct);

        logger.LogInformation("Reset orchestrator: entered resetting phase for {CorrelationId}.", correlationId);

        // Check GateMaxTtl before clearing.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier, ct);
            return;
        }

        // ── Phase: resetting — clear data ─────────────────────────────────────
        await ClearDataTablesAsync(db, ct);
        logger.LogInformation("Reset orchestrator: data cleared for reset {ResetId}.", resetId);

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(ResetTrigger.Complete);
        ResetCoordination.ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, ct);

        // Notify all instances that the gate is now OFF (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        var resetCompletedEvent = ResetCoordination.BuildControlEvent(ResetCoordination.EventResetCompleted, correlationId);
        await controlStream.InsertAsync(resetCompletedEvent, ct);
        await notifier.NotifyAsync(resetCompletedEvent, ct);

        logger.LogInformation("Reset orchestrator: reset {CorrelationId} completed.", correlationId);
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
                while (acksBroadcaster.AckReader.TryRead(out var ack))
                {
                    if (!Guid.TryParse(ack.CorrelationId, out var ackCorrelationId) || ackCorrelationId != cycle.CorrelationId)
                        continue;

                    if (acksReceived.Add(ack.ComponentId))
                    {
                        cycle.AcksReceived = [.. acksReceived];
                        await SaveCycleAsync(db, cycle, ct);
                        logger.LogInformation(
                            "Reset orchestrator: ack received from {ComponentId} ({Count}/{Total}).",
                            ack.ComponentId, acksReceived.Count, expectedComponents.Length);
                    }

                    if (acksReceived.IsSupersetOf(expectedComponents))
                        return;
                }
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Inner ack-wait timeout elapsed; proceed with however many acks arrived.
            logger.LogInformation(
                "Reset orchestrator: ack timeout elapsed for correlation_id {CorrelationId}; proceeding with {Count}/{Total} acks.",
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
        logger.LogWarning("Reset orchestrator: GateMaxTtl exceeded; aborting reset {CorrelationId}.", cycle.CorrelationId);

        var abortedResetId = cycle.CorrelationId ?? Guid.Empty;

        var machine = new ResetStateMachine(cycle);
        if (!machine.IsInState(ResetState.Idle))
            machine.Fire(ResetTrigger.Abort);
        ResetCoordination.ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, abortCt);

        // Emit reset-completed so connected components (fetcher, demo-driver) can recover
        // via the control stream — mirrors the reconciler abort path.
        if (abortedResetId != Guid.Empty)
        {
            var completedEvent = ResetCoordination.BuildControlEvent(ResetCoordination.EventResetCompleted, abortedResetId);
            await controlStream.InsertAsync(completedEvent, abortCt);
            await notifier.NotifyAsync(completedEvent, abortCt);
        }

        // Release the gate flag on all instances (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, abortCt);
    }

    // Fallback abort for unhandled exceptions.  resetId hint is used if the cycle row has
    // already been cleared or is mismatched.  Uses appStopping (non-cancelled) for all IO.
    private async Task TryAbortAsync(Guid resetId, CancellationToken appStopping)
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
            else if (resetId != Guid.Empty)
            {
                // Cycle already idle (may have been cleaned up), but still emit reset-completed
                // so any components still waiting on the stream can recover.
                var completedEvent = ResetCoordination.BuildControlEvent(ResetCoordination.EventResetCompleted, resetId);
                await controlStream.InsertAsync(completedEvent, appStopping);
                await notifier.NotifyAsync(completedEvent, appStopping);
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
    /// </summary>
    internal async Task ExecuteAbortAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        CancellationToken ct)
        => await AbortCycleAsync(db, cycle, controlStream, notifier, stateNotifier: null, ct);

    // ── Data clearing (D14: only deployment_events + fetcher_state) ───────────

    private static async Task ClearDataTablesAsync(DashboardDbContext db, CancellationToken ct)
    {
        await db.DeploymentEvents.ExecuteDeleteAsync(ct);
        await db.FetcherStates.ExecuteDeleteAsync(ct);
    }

    // ── Advisory lock helpers ─────────────────────────────────────────────────

    private static async Task<bool> TryAcquireAdvisoryLockAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"SELECT pg_try_advisory_lock({ResetCoordination.AdvisoryLockKey})", conn);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is true;
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

    // ── DB helpers ────────────────────────────────────────────────────────────

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
        }

        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }
}
