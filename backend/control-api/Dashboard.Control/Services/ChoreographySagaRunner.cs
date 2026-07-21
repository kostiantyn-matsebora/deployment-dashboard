using Dashboard.Control.Options;
using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Services;

/// <summary>
/// Template for the operation-agnostic saga skeleton shared by <see cref="ResetOrchestrator"/> and
/// <see cref="RecoverOrchestrator"/>: acquire the advisory lock (<see cref="ChoreographyLock"/>),
/// bound the cycle by <c>GateMaxTtlSeconds</c>, drive the operation-specific
/// <paramref name="runCycleAsync"/> step, and force-abort via <paramref name="tryAbortAsync"/> on
/// wall-clock timeout or unhandled exception — always releasing the lock. The only per-operation
/// hooks are the two delegates; the choreography shape itself (lock/timeout/error handling/log
/// wording) is identical for reset and recover, so it now exists in exactly one place.
/// </summary>
internal static class ChoreographySagaRunner
{
    public static async Task RunAsync(
        IServiceProvider services,
        ChoreographyIdentity identity,
        Guid operationId,
        ResetOptions options,
        CancellationToken appStopping,
        Func<Guid, ResetOptions, CancellationToken, Task> runCycleAsync,
        Func<Guid, CancellationToken, Task> tryAbortAsync)
    {
        var lockConn = await ChoreographyLock.TryOpenAndAcquireLockAsync(services, identity, appStopping);
        if (lockConn is null)
            return;

        identity.Logger.LogInformation(
            "{Operation} orchestrator: advisory lock acquired for {op} {OperationId}.",
            identity.OperationLabel, identity.LowerLabel, operationId);

        // Hard wall-clock ceiling on the entire cycle.  If any await inside the cycle
        // (including data-clearing, for reset) hangs past GateMaxTtlSeconds the linked token
        // fires, the catch below force-aborts with a non-cancelled token, and the finally
        // releases the advisory lock — guaranteeing the system is never wedged longer than
        // GateMaxTtlSeconds (D12, §9).
        await using var _ = lockConn;
        using var processCts = new CancellationTokenSource(TimeSpan.FromSeconds(options.GateMaxTtlSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(appStopping, processCts.Token);

        try
        {
            await runCycleAsync(operationId, options, linkedCts.Token);
        }
        catch (OperationCanceledException) when (
            processCts.IsCancellationRequested && !appStopping.IsCancellationRequested)
        {
            // Wall-clock timeout fired — not a graceful shutdown.  Force the cycle back to
            // idle and emit the matching *-completed event so components can recover.
            identity.Logger.LogWarning(
                "{Operation} orchestrator: GateMaxTtlSeconds ({Ttl}s) wall-clock ceiling reached; " +
                "force-aborting {op} {OperationId}.",
                identity.OperationLabel, options.GateMaxTtlSeconds, identity.LowerLabel, operationId);
            await tryAbortAsync(operationId, appStopping);
        }
        catch (Exception ex) when (!appStopping.IsCancellationRequested)
        {
            identity.Logger.LogError(
                ex, "{Operation} orchestrator: unhandled error; forcing abort for {op} {OperationId}.",
                identity.OperationLabel, identity.LowerLabel, operationId);
            await tryAbortAsync(operationId, appStopping);
        }
        finally
        {
            await ChoreographyLock.ReleaseAsync(lockConn, appStopping);
            identity.Logger.LogInformation(
                "{Operation} orchestrator: advisory lock released for {op} {OperationId}.",
                identity.OperationLabel, identity.LowerLabel, operationId);
        }
    }
}
