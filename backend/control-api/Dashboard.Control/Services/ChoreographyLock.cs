using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Services;

/// <summary>
/// Advisory-lock acquire/release for the reset/recover choreography (fixed key
/// <see cref="ResetCoordination.AdvisoryLockKey"/>, D12, NFR-05). Operation-agnostic saga
/// plumbing shared by <see cref="ResetOrchestrator"/> and <see cref="RecoverOrchestrator"/> via
/// <see cref="ChoreographySagaRunner"/>, so the acquire/release logic (and its logging) exists in
/// exactly one place instead of two hand-rolled copies.
/// </summary>
internal static class ChoreographyLock
{
    /// <summary>
    /// Opens a dedicated Postgres connection and attempts to acquire the advisory lock.
    /// Returns <c>null</c> when the connection string is missing, the lock is held by another
    /// instance (e.g. a reset or recover already driving), or the lock query fails; the caller
    /// should return without driving. Returns the open connection (non-null) only when the lock
    /// is held.
    /// </summary>
    public static async Task<NpgsqlConnection?> TryOpenAndAcquireLockAsync(
        IServiceProvider services,
        ChoreographyIdentity identity,
        CancellationToken ct)
    {
        var dataSource = services.GetService<NpgsqlDataSource>();

        if (dataSource is null)
        {
            identity.Logger.LogWarning("{Operation} orchestrator: NpgsqlDataSource not available; skipping.", identity.OperationLabel);
            return null;
        }

        var lockConn = dataSource.CreateConnection();
        await lockConn.OpenAsync(ct);

        bool lockAcquired;
        try
        {
            lockAcquired = await TryAcquireAsync(lockConn, ct);
        }
        catch (Exception ex)
        {
            await lockConn.DisposeAsync();
            identity.Logger.LogError(ex, "{Operation} orchestrator: failed to acquire advisory lock.", identity.OperationLabel);
            return null;
        }

        if (!lockAcquired)
        {
            await lockConn.DisposeAsync();
            identity.Logger.LogInformation("{Operation} orchestrator: advisory lock held by another instance; yielding.", identity.OperationLabel);
            return null;
        }

        return lockConn;
    }

    public static async Task ReleaseAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(
                $"SELECT pg_advisory_unlock({ResetCoordination.AdvisoryLockKey})", conn);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch { /* Best-effort: connection may already be closed. */ }
    }

    private static async Task<bool> TryAcquireAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"SELECT pg_try_advisory_lock({ResetCoordination.AdvisoryLockKey})", conn);
        var result = await cmd.ExecuteScalarAsync(ct);
        return result is true;
    }
}
