using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Services;

/// <summary>
/// Handles <c>POST /api/control/reset</c>:
/// <list type="bullet">
///   <item>Atomically claims the idle row via a conditional UPDATE (Fix B); returns <c>null</c> (→ 409) if not idle.</item>
///   <item>Emits <c>reset-initiated</c> after a successful claim.</item>
///   <item>Returns <see cref="ResetAcceptance"/> (→ 202) immediately.</item>
///   <item>Fires the background orchestrator on the thread pool with the host's ApplicationStopping token (Fix D).</item>
/// </list>
/// </summary>
internal sealed class ResetService(
    IResetCycleRepository cycleRepository,
    IControlStreamRepository controlStream,
    IControlEventNotifier notifier,
    IResetOrchestrator orchestrator,
    IHostApplicationLifetime lifetime,
    IOptions<ResetOptions> options,
    ILogger<ResetService> logger) : IResetService
{
    public async Task<ResetAcceptance?> TryInitiateAsync(CancellationToken ct = default)
    {
        var opts = options.Value;
        var resetId = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;

        // Build the draining row up-front; TryClaimIdleAsync writes it atomically only if
        // the current row is idle (affected-rows == 0 → 409, no separate read needed).
        var claimedCycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            ResetId = resetId,
            ExpectedComponents = opts.ExpectedComponents,
            AcksReceived = [],
            StartedAt = now,
            DeadlineAt = now.AddSeconds(opts.AckTimeoutSeconds),
        };

        var claimed = await cycleRepository.TryClaimIdleAsync(claimedCycle, ct);
        if (!claimed)
        {
            logger.LogInformation("Reset already in flight; conditional UPDATE matched 0 rows → 409.");
            return null;
        }

        var initiatedEvent = new ControlStreamEvent
        {
            Id = resetId, // Per spec: reset-initiated event id IS the reset_id correlated by others.
            Type = "reset-initiated",
            Component = "*",
            OccurredAt = now,
        };
        await controlStream.InsertAsync(initiatedEvent, ct);
        await notifier.NotifyAsync(initiatedEvent, ct);

        logger.LogInformation("Reset initiated: reset_id={ResetId}.", resetId);

        // Fire-and-forget the orchestrator on the thread pool.
        // Pass ApplicationStopping so the drive aborts cleanly on graceful shutdown (Fix D).
        var appStopping = lifetime.ApplicationStopping;
        _ = Task.Run(() => orchestrator.DriveAsync(resetId, opts, appStopping), appStopping);

        return new ResetAcceptance(resetId, ResetState.Draining, now);
    }
}
