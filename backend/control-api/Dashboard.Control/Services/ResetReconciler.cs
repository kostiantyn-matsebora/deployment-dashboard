using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Dashboard.Control.Services;

/// <summary>
/// Runs on startup and every <see cref="TickIntervalSeconds"/> thereafter.
/// Detects orphaned reset cycles left behind by a crashed driving instance and aborts them.
///
/// Algorithm (per tick):
/// <list type="number">
///   <item>Try <c>pg_try_advisory_lock(7654321)</c> on a dedicated connection.
///         The active orchestrator already holds this lock, so the reconciler
///         yields without doing anything — double-driving is impossible.</item>
///   <item>If the lock was acquired, load the cycle row.</item>
///   <item>If state is non-idle AND <c>now &gt;= StartedAt + GateMaxTtlSeconds</c>,
///         abort: write idle, emit <c>reset-completed</c> on the control stream
///         (so blocked components recover), and publish the reset-state NOTIFY
///         (so the per-instance gate flag updates, Fix C).</item>
///   <item>Release the lock.</item>
/// </list>
///
/// A surviving / restarted instance picks up orphans within one tick interval.
/// </summary>
internal sealed class ResetReconciler(
    IServiceProvider services,
    IOptions<ResetOptions> resetOptions,
    ILogger<ResetReconciler> logger) : BackgroundService
{
    internal const int TickIntervalSeconds = 5;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // First tick at startup; subsequent ticks every TickIntervalSeconds.
        while (!stoppingToken.IsCancellationRequested)
        {
            await TickAsync(stoppingToken);

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(TickIntervalSeconds), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var lockConn = await TryOpenLockConnectionAsync(ct);
        if (lockConn is null)
            return;

        await using var _ = lockConn; // guarantees disposal on every exit path

        bool lockAcquired;
        try
        {
            lockAcquired = await TryAcquireAdvisoryLockAsync(lockConn, ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Reset reconciler: advisory lock query failed; skipping tick.");
            return;
        }

        if (!lockAcquired)
        {
            // Active orchestrator holds the lock — cycle is being driven, nothing to do.
            return;
        }

        try
        {
            await InspectAndAbortIfOrphanedAsync(ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogError(ex, "Reset reconciler: error while inspecting cycle.");
        }
        finally
        {
            // Release before the connection is disposed (session-level lock semantics).
            await ReleaseAdvisoryLockAsync(lockConn);
        }
    }

    private async Task InspectAndAbortIfOrphanedAsync(CancellationToken ct)
    {
        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<DashboardDbContext>();

        var cycle = await db.ResetCycles.FindAsync([(short)1], ct);
        if (cycle is null || cycle.State == ResetState.Idle)
            return; // No cycle in flight.

        var opts = resetOptions.Value;
        var gateMaxDeadline = (cycle.StartedAt ?? DateTimeOffset.UtcNow)
            .AddSeconds(opts.GateMaxTtlSeconds);

        if (DateTimeOffset.UtcNow < gateMaxDeadline)
            return; // Cycle is alive and within its TTL — leave it alone.

        // Orphan detected: abort.
        var operation = string.IsNullOrEmpty(cycle.Operation) ? ControlOperation.Reset : cycle.Operation;
        logger.LogWarning(
            "Reset reconciler: orphaned {Operation} cycle detected (state={State}, correlation_id={CorrelationId}, deadline={Deadline}). Aborting.",
            operation, cycle.State, cycle.CorrelationId, gateMaxDeadline);

        var abortedResetId = cycle.CorrelationId ?? Guid.Empty;
        var recoverSince = cycle.RecoverSince;
        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();
        var stateNotifier = sp.GetService<IResetStateNotifier>();

        // Correlation-guarded release: no-ops (0 rows) if a fresh claim has since superseded this
        // orphan on the shared row (e.g. a new cycle claimed it between the load above and here).
        // Guarding on the orphaned cycle's OWN correlation_id — already loaded — means a genuine
        // orphan (row still correlation-matched) is unaffected; only a superseded one is skipped.
        if (!await ClearCycleToIdleAsync(db, cycle, abortedResetId, stateNotifier, ct))
        {
            logger.LogDebug(
                "Reset reconciler: orphan clear no-op for {CorrelationId}; cycle was already superseded.",
                abortedResetId);
            return;
        }

        // Emit the operation-matched *-completed (reset-completed | recover-completed) so
        // connected components can recover.
        await EmitOrphanRecoveryEventAsync(controlStream, notifier, abortedResetId, operation, recoverSince, ct);

        logger.LogInformation("Reset reconciler: orphaned {Operation} cycle aborted; state reset to idle.", operation);
    }

    /// <summary>
    /// Opens a dedicated Postgres connection for advisory-lock use.
    /// Returns <c>null</c> (and logs) when the connection string is missing or
    /// the connection cannot be established.
    /// </summary>
    private async Task<NpgsqlConnection?> TryOpenLockConnectionAsync(CancellationToken ct)
    {
        var dataSource = services.GetService<NpgsqlDataSource>();

        if (dataSource is null)
            return null;

        var conn = dataSource.CreateConnection();
        try
        {
            await conn.OpenAsync(ct);
            return conn;
        }
        catch (Exception ex)
        {
            await conn.DisposeAsync();
            logger.LogWarning(ex, "Reset reconciler: could not open DB connection; skipping tick.");
            return null;
        }
    }

    /// <summary>
    /// Emits the operation-matched <c>*-completed</c> event (<c>reset-completed</c> for a stuck
    /// reset, <c>recover-completed</c> — carrying the resolved <c>{"since":"…"}</c> payload — for
    /// a stuck recovery) so connected components can recover.
    /// </summary>
    private static async Task EmitOrphanRecoveryEventAsync(
        IControlStreamRepository controlStream,
        IControlEventNotifier notifier,
        Guid abortedResetId,
        string operation,
        DateTimeOffset? recoverSince,
        CancellationToken ct)
    {
        if (abortedResetId == Guid.Empty)
            return;

        var completedEvent = new ControlStreamEvent
        {
            Id = Guid.CreateVersion7(),
            Type = $"{operation}-completed",
            Component = "*",
            CorrelationId = abortedResetId,
            OccurredAt = DateTimeOffset.UtcNow,
            Payload = operation == ControlOperation.Recover && recoverSince is { } since
                ? RecoverPayload.Build(since)
                : null,
        };
        await controlStream.InsertAsync(completedEvent, ct);
        await notifier.NotifyAsync(completedEvent, ct);
    }

    /// <summary>
    /// Correlation-guarded release to the idle baseline (see
    /// <see cref="ChoreographyCycleStore.TryReleaseToIdleAsync"/> — the same conditional UPDATE
    /// shared by <see cref="ResetOrchestrator"/> and <see cref="RecoverOrchestrator"/>, so the
    /// "idle" field set + release predicate have exactly one definition across all three callers).
    /// Returns <c>false</c> (no-op) when <paramref name="expectedCorrelationId"/> no longer
    /// matches the row — a fresh cycle claimed it between the orphan-check load and this write —
    /// in which case the caller must not notify or emit a completion event for it.
    /// </summary>
    private static async Task<bool> ClearCycleToIdleAsync(
        DashboardDbContext db,
        ResetCycle cycle,
        Guid expectedCorrelationId,
        IResetStateNotifier? stateNotifier,
        CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var repository = new ResetCycleRepository(db);
        var released = await repository.TryReleaseToIdleAsync(expectedCorrelationId, ct);
        db.ChangeTracker.Clear();

        if (!released)
            return false;

        ChoreographyCycleStore.ResetToIdleBaseline(cycle);

        // Notify all instances to update their cached gate flag (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        return true;
    }

    private static async Task<bool> TryAcquireAdvisoryLockAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"SELECT pg_try_advisory_lock({ResetCoordination.AdvisoryLockKey})", conn);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is true;
    }

    private static async Task ReleaseAdvisoryLockAsync(NpgsqlConnection conn)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(
                $"SELECT pg_advisory_unlock({ResetCoordination.AdvisoryLockKey})", conn);
            await cmd.ExecuteNonQueryAsync();
        }
        catch { /* Best-effort: connection may already be closing. */ }
    }
}
