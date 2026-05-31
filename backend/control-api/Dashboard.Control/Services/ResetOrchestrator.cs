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
            ?.GetConnectionString("Postgres");

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

        try
        {
            await RunCycleAsync(resetId, options, appStopping);
        }
        catch (Exception ex) when (!appStopping.IsCancellationRequested)
        {
            logger.LogError(ex, "Reset orchestrator: unhandled error; forcing abort for reset {ResetId}.", resetId);
            await TryAbortAsync(appStopping);
        }
        finally
        {
            await ReleaseAdvisoryLockAsync(lockConn, appStopping);
            logger.LogInformation("Reset orchestrator: advisory lock released for reset {ResetId}.", resetId);
        }
    }

    private async Task RunCycleAsync(
        Guid resetId,
        ResetOptions options,
        CancellationToken appStopping)
    {
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<DashboardDbContext>();
        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();
        var stateNotifier = sp.GetService<IResetStateNotifier>();

        // ── Phase: draining — wait for acks or AckTimeout ────────────────────
        var cycle = await LoadCycleAsync(db, appStopping);
        if (cycle.ResetId != resetId)
        {
            logger.LogWarning("Reset orchestrator: reset_id mismatch; expected {Expected}, got {Actual}. Aborting.",
                resetId, cycle.ResetId);
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

        await WaitForAcksOrTimeoutAsync(db, cycle, ackDeadline, gateMaxDeadline, options, appStopping);

        // Check GateMaxTtl before proceeding to resetting.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, stateNotifier, appStopping);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        machine.Fire(ResetTrigger.AcksIn);
        await SaveCycleAsync(db, cycle, appStopping);

        // Notify all instances that the gate is now ON (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Resetting, appStopping);

        var resetStartedEvent = BuildControlEvent("reset-started", resetId);
        await controlStream.InsertAsync(resetStartedEvent, appStopping);
        await notifier.NotifyAsync(resetStartedEvent, appStopping);

        logger.LogInformation("Reset orchestrator: entered resetting phase for {ResetId}.", resetId);

        // Check GateMaxTtl before clearing.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, stateNotifier, appStopping);
            return;
        }

        // ── Phase: resetting — clear data ─────────────────────────────────────
        await ClearDataTablesAsync(db, appStopping);
        logger.LogInformation("Reset orchestrator: data cleared for reset {ResetId}.", resetId);

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(ResetTrigger.Complete);
        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, appStopping);

        // Notify all instances that the gate is now OFF (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, appStopping);

        var resetCompletedEvent = BuildControlEvent("reset-completed", resetId);
        await controlStream.InsertAsync(resetCompletedEvent, appStopping);
        await notifier.NotifyAsync(resetCompletedEvent, appStopping);

        logger.LogInformation("Reset orchestrator: reset {ResetId} completed.", resetId);
    }

    private async Task WaitForAcksOrTimeoutAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        DateTimeOffset ackDeadline,
        DateTimeOffset gateMaxDeadline,
        ResetOptions options,
        CancellationToken appStopping)
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
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(appStopping, timeoutCts.Token);

        try
        {
            while (await acksBroadcaster.AckReader.WaitToReadAsync(linked.Token))
            {
                while (acksBroadcaster.AckReader.TryRead(out var ack))
                {
                    if (!Guid.TryParse(ack.ResetId, out var ackResetId) || ackResetId != cycle.ResetId)
                        continue;

                    if (acksReceived.Add(ack.ComponentId))
                    {
                        cycle.AcksReceived = [.. acksReceived];
                        await SaveCycleAsync(db, cycle, appStopping);
                        logger.LogInformation(
                            "Reset orchestrator: ack received from {ComponentId} ({Count}/{Total}).",
                            ack.ComponentId, acksReceived.Count, expectedComponents.Length);
                    }

                    if (acksReceived.IsSupersetOf(expectedComponents))
                        return;
                }
            }
        }
        catch (OperationCanceledException) when (!appStopping.IsCancellationRequested)
        {
            logger.LogInformation(
                "Reset orchestrator: ack timeout elapsed for reset {ResetId}; proceeding with {Count}/{Total} acks.",
                cycle.ResetId, acksReceived.Count, expectedComponents.Length);
        }
    }

    private async Task AbortCycleAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        IResetStateNotifier? stateNotifier,
        CancellationToken ct)
    {
        logger.LogWarning("Reset orchestrator: GateMaxTtl exceeded; aborting reset {ResetId}.", cycle.ResetId);
        var machine = new ResetStateMachine(cycle);
        if (!machine.IsInState(ResetState.Idle))
            machine.Fire(ResetTrigger.Abort);
        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, ct);

        // Release the gate flag on all instances (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, ct);
    }

    private async Task TryAbortAsync(CancellationToken ct)
    {
        try
        {
            await using var abortScope = services.CreateAsyncScope();
            var sp = abortScope.ServiceProvider;
            var abortDb = sp.GetRequiredService<DashboardDbContext>();
            var stateNotifier = sp.GetService<IResetStateNotifier>();
            var cycle = await LoadCycleAsync(abortDb, ct);
            if (cycle.State != ResetState.Idle)
                await AbortCycleAsync(abortDb, cycle, stateNotifier, ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Reset orchestrator: error during abort.");
        }
    }

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
            existing.ResetId = cycle.ResetId;
            existing.ExpectedComponents = cycle.ExpectedComponents;
            existing.AcksReceived = cycle.AcksReceived;
            existing.StartedAt = cycle.StartedAt;
            existing.DeadlineAt = cycle.DeadlineAt;
        }

        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }

    private static ControlStreamEvent BuildControlEvent(string type, Guid resetId) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = type,
            Component = "*",
            ResetId = resetId,
            OccurredAt = DateTimeOffset.UtcNow,
        };

    private static void ClearCycleFields(ResetCycle cycle)
    {
        cycle.State = ResetState.Idle;
        cycle.ResetId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
    }
}
