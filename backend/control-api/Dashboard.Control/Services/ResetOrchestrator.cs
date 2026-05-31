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
using Microsoft.Extensions.Options;
using Npgsql;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the reset choreography state machine from <c>draining</c> through <c>resetting</c>
/// back to <c>idle</c>. Runs on a dedicated background thread started by
/// <see cref="ResetService.StartChoreographyAsync"/> after the endpoint returns <c>202</c>.
///
/// Advisory lock (fixed key <c>7654321</c>) ensures only one instance drives the cycle
/// at a time across horizontally-scaled replicas (D12, NFR-05).
/// </summary>
internal sealed class ResetOrchestrator(
    IServiceProvider services,
    ComponentAcksBroadcaster acksBroadcaster,
    ILogger<ResetOrchestrator> logger) : IResetOrchestrator
{
    // Fixed Postgres advisory lock key — unique to the reset choreography.
    private const long AdvisoryLockKey = 7_654_321L;

    public async Task DriveAsync(
        Guid resetId,
        ResetOptions options,
        CancellationToken appStopping)
    {
        // Try to acquire the non-blocking advisory lock. If another instance already holds it,
        // this instance yields — the holder is driving the cycle.
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        bool lockAcquired;
        try
        {
            lockAcquired = await TryAcquireAdvisoryLockAsync(db, appStopping);
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
            await RunCycleAsync(db, scope.ServiceProvider, resetId, options, appStopping);
        }
        catch (Exception ex) when (!appStopping.IsCancellationRequested)
        {
            logger.LogError(ex, "Reset orchestrator: unhandled error; forcing abort for reset {ResetId}.", resetId);
            await TryAbortAsync(scope.ServiceProvider, appStopping);
        }
        finally
        {
            await ReleaseAdvisoryLockAsync(db, appStopping);
            logger.LogInformation("Reset orchestrator: advisory lock released for reset {ResetId}.", resetId);
        }
    }

    private async Task RunCycleAsync(
        DashboardDbContext db,
        IServiceProvider sp,
        Guid resetId,
        ResetOptions options,
        CancellationToken appStopping)
    {
        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();

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

        var ackTimeout = cycle.DeadlineAt ?? DateTimeOffset.UtcNow.AddSeconds(options.AckTimeoutSeconds);
        var gateMaxDeadline = cycle.StartedAt?.AddSeconds(options.GateMaxTtlSeconds) ?? ackTimeout;

        await WaitForAcksOrTimeoutAsync(db, cycle, machine, ackTimeout, gateMaxDeadline, options, appStopping);

        // Reload to ensure we are still the driver (another instance might have taken over after a crash).
        cycle = await LoadCycleAsync(db, appStopping);
        if (cycle.ResetId != resetId || !machine.IsInState(ResetState.Draining))
        {
            logger.LogWarning("Reset orchestrator: state changed unexpectedly after ack wait. Aborting.");
            return;
        }

        // Check GateMaxTtl before proceeding to resetting.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, appStopping);
            return;
        }

        // ── Draining → Resetting ──────────────────────────────────────────────
        machine.Fire(ResetTrigger.AcksIn);
        await SaveCycleAsync(db, cycle, appStopping);

        var resetStartedEvent = BuildControlEvent("reset-started", resetId);
        await controlStream.InsertAsync(resetStartedEvent, appStopping);
        await notifier.NotifyAsync(resetStartedEvent, appStopping);

        logger.LogInformation("Reset orchestrator: entered resetting phase for {ResetId}.", resetId);

        // ── Phase: resetting — clear data ─────────────────────────────────────

        // Check GateMaxTtl before clearing.
        if (DateTimeOffset.UtcNow >= gateMaxDeadline)
        {
            await AbortCycleAsync(db, cycle, appStopping);
            return;
        }

        await ClearDataTablesAsync(db, appStopping);
        logger.LogInformation("Reset orchestrator: data cleared for reset {ResetId}.", resetId);

        // ── Resetting → Idle ──────────────────────────────────────────────────
        machine.Fire(ResetTrigger.Complete);
        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, appStopping);

        var resetCompletedEvent = BuildControlEvent("reset-completed", resetId);
        await controlStream.InsertAsync(resetCompletedEvent, appStopping);
        await notifier.NotifyAsync(resetCompletedEvent, appStopping);

        logger.LogInformation("Reset orchestrator: reset {ResetId} completed.", resetId);
    }

    private async Task WaitForAcksOrTimeoutAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        ResetStateMachine machine,
        DateTimeOffset ackDeadline,
        DateTimeOffset gateMaxDeadline,
        ResetOptions options,
        CancellationToken appStopping)
    {
        var expectedComponents = cycle.ExpectedComponents ?? options.ExpectedComponents;
        var acksReceived = new HashSet<string>(cycle.AcksReceived ?? [], StringComparer.Ordinal);

        if (acksReceived.Count >= expectedComponents.Length)
            return; // Already have all acks.

        using var ackTimeoutCts = new CancellationTokenSource(
            TimeSpan.FromMilliseconds(Math.Max(0, (ackDeadline - DateTimeOffset.UtcNow).TotalMilliseconds)));
        using var gateMaxCts = new CancellationTokenSource(
            TimeSpan.FromMilliseconds(Math.Max(0, (gateMaxDeadline - DateTimeOffset.UtcNow).TotalMilliseconds)));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            appStopping, ackTimeoutCts.Token, gateMaxCts.Token);

        try
        {
            while (await acksBroadcaster.AckReader.WaitToReadAsync(linked.Token))
            {
                while (acksBroadcaster.AckReader.TryRead(out var ack))
                {
                    if (!Guid.TryParse(ack.ResetId, out var ackResetId) || ackResetId != cycle.ResetId)
                        continue; // Stale or mismatched ack — ignore.

                    if (acksReceived.Add(ack.ComponentId))
                    {
                        cycle.AcksReceived = [.. acksReceived];
                        await SaveCycleAsync(db, cycle, appStopping);
                        logger.LogInformation(
                            "Reset orchestrator: ack received from {ComponentId} ({Count}/{Total}).",
                            ack.ComponentId, acksReceived.Count, expectedComponents.Length);
                    }

                    if (acksReceived.IsSupersetOf(expectedComponents))
                        return; // All expected acks received.
                }
            }
        }
        catch (OperationCanceledException) when (!appStopping.IsCancellationRequested)
        {
            // Ack timeout or GateMaxTtl elapsed — proceed (D13: components are optional).
            logger.LogInformation(
                "Reset orchestrator: ack timeout/gate-max elapsed for reset {ResetId}; proceeding with {Count}/{Total} acks.",
                cycle.ResetId, acksReceived.Count, expectedComponents.Length);
        }
    }

    private async Task AbortCycleAsync(DashboardDbContext db, ResetCycle cycle, CancellationToken ct)
    {
        logger.LogWarning("Reset orchestrator: GateMaxTtl exceeded; aborting reset {ResetId}.", cycle.ResetId);
        var machine = new ResetStateMachine(cycle);
        machine.Fire(ResetTrigger.Abort);
        ClearCycleFields(cycle);
        await SaveCycleAsync(db, cycle, ct);
    }

    private async Task TryAbortAsync(IServiceProvider sp, CancellationToken ct)
    {
        try
        {
            await using var abortScope = services.CreateAsyncScope();
            var abortDb = abortScope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            var cycle = await LoadCycleAsync(abortDb, ct);
            if (cycle.State != ResetState.Idle)
                await AbortCycleAsync(abortDb, cycle, ct);
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

    private static async Task<bool> TryAcquireAdvisoryLockAsync(DashboardDbContext db, CancellationToken ct)
    {
        // pg_try_advisory_lock is non-blocking; returns false if the lock is held by another session.
        var result = await db.Database
            .SqlQueryRaw<bool>($"SELECT pg_try_advisory_lock({AdvisoryLockKey})")
            .FirstAsync(ct);
        return result;
    }

    private static async Task ReleaseAdvisoryLockAsync(DashboardDbContext db, CancellationToken ct)
    {
        await db.Database.ExecuteSqlRawAsync(
            $"SELECT pg_advisory_unlock({AdvisoryLockKey})", ct);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static async Task<ResetCycle> LoadCycleAsync(DashboardDbContext db, CancellationToken ct)
    {
        return await db.ResetCycles.FindAsync([(short)1], ct)
               ?? new ResetCycle { Id = 1, State = ResetState.Idle };
    }

    private static async Task SaveCycleAsync(DashboardDbContext db, ResetCycle cycle, CancellationToken ct)
    {
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
        db.ChangeTracker.Clear(); // Detach so subsequent FindAsync loads fresh from DB.
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
        cycle.ResetId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
    }
}
