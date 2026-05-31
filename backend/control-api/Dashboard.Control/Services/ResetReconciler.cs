using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
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
    private const long AdvisoryLockKey = 7_654_321L;
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
        var connectionString = services.GetService<IConfiguration>()
            ?.GetConnectionString("Postgres");

        if (string.IsNullOrEmpty(connectionString))
            return;

        await using var lockConn = new NpgsqlConnection(connectionString);
        try
        {
            await lockConn.OpenAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Reset reconciler: could not open DB connection; skipping tick.");
            return;
        }

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
        logger.LogWarning(
            "Reset reconciler: orphaned cycle detected (state={State}, reset_id={ResetId}, deadline={Deadline}). Aborting.",
            cycle.State, cycle.ResetId, gateMaxDeadline);

        var abortedResetId = cycle.ResetId ?? Guid.Empty;

        var controlStream = sp.GetRequiredService<IControlStreamRepository>();
        var notifier = sp.GetRequiredService<IControlEventNotifier>();
        var stateNotifier = sp.GetService<IResetStateNotifier>();

        // Emit reset-completed so connected components can recover.
        if (abortedResetId != Guid.Empty)
        {
            var completedEvent = new ControlStreamEvent
            {
                Id = Guid.CreateVersion7(),
                Type = "reset-completed",
                Component = "*",
                ResetId = abortedResetId,
                OccurredAt = DateTimeOffset.UtcNow,
            };
            await controlStream.InsertAsync(completedEvent, ct);
            await notifier.NotifyAsync(completedEvent, ct);
        }

        // Transition cycle to idle.
        cycle.State = ResetState.Idle;
        cycle.ResetId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
        await db.SaveChangesAsync(ct);

        // Notify all instances to update their cached gate flag (Fix C).
        if (stateNotifier is not null)
            await stateNotifier.NotifyStateAsync(ResetState.Idle, ct);

        logger.LogInformation("Reset reconciler: orphaned cycle aborted; state reset to idle.");
    }

    private static async Task<bool> TryAcquireAdvisoryLockAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"SELECT pg_try_advisory_lock({AdvisoryLockKey})", conn);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is true;
    }

    private static async Task ReleaseAdvisoryLockAsync(NpgsqlConnection conn)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(
                $"SELECT pg_advisory_unlock({AdvisoryLockKey})", conn);
            await cmd.ExecuteNonQueryAsync();
        }
        catch { /* Best-effort: connection may already be closing. */ }
    }
}
