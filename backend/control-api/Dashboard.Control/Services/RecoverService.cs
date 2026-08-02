using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Services;

/// <summary>
/// Handles <c>POST /api/control/recover</c>:
/// <list type="bullet">
///   <item>Shares reset's single-flight row (id=1) — atomically claims the idle row via the
///     same conditional UPDATE (Fix B); returns <c>null</c> (→ 409) if a reset or recover is
///     already in flight.</item>
///   <item>Tags the claimed row <c>operation="recover"</c> + <c>recover_since=since</c> so the
///     orchestrator and reconciler drive/report the recover choreography, not reset's.</item>
///   <item>Emits <c>recover-initiated</c> after a successful claim.</item>
///   <item>Returns <see cref="RecoverAcceptance"/> (→ 202) immediately.</item>
///   <item>Fires the background orchestrator on the thread pool with the host's ApplicationStopping token (Fix D).</item>
/// </list>
/// Reuses <see cref="ResetOptions"/> (ack timeout, expected components, gate TTL) — these knobs
/// describe the shared choreography mechanics, not reset-specific behavior.
/// </summary>
internal sealed class RecoverService(
    IResetCycleRepository cycleRepository,
    IControlStreamRepository controlStream,
    IControlEventNotifier notifier,
    IRecoverOrchestrator orchestrator,
    IHostApplicationLifetime lifetime,
    IOptions<ResetOptions> options,
    ILogger<RecoverService> logger) : IRecoverService
{
    public async Task<RecoverAcceptance?> TryInitiateAsync(DateTimeOffset since, CancellationToken ct = default)
    {
        var opts = options.Value;
        var recoverId = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;

        // Build the draining row up-front; TryClaimIdleAsync writes it atomically only if
        // the current row is idle (affected-rows == 0 → 409, no separate read needed).
        var claimedCycle = BuildClaimedCycle(recoverId, since, now, opts);

        var claimed = await cycleRepository.TryClaimIdleAsync(claimedCycle, ct);
        if (!claimed)
        {
            logger.LogInformation("Recover already in flight (or a reset is); conditional UPDATE matched 0 rows → 409.");
            return null;
        }

        var initiatedEvent = BuildInitiatedEvent(recoverId, now);
        await controlStream.InsertAsync(initiatedEvent, ct);
        await notifier.NotifyAsync(initiatedEvent, ct);

        logger.LogInformation("Recover initiated: correlation_id={CorrelationId}, since={Since}.", recoverId, since);

        // Fire-and-forget the orchestrator on the thread pool.
        // Pass ApplicationStopping so the drive aborts cleanly on graceful shutdown (Fix D).
        var appStopping = lifetime.ApplicationStopping;
        _ = Task.Run(() => orchestrator.DriveAsync(recoverId, opts, appStopping), appStopping);

        return new RecoverAcceptance(recoverId, ResetState.Draining, since, now);
    }

    private static ResetCycle BuildClaimedCycle(Guid recoverId, DateTimeOffset since, DateTimeOffset now, ResetOptions opts) =>
        new()
        {
            Id = 1,
            State = ResetState.Draining,
            Operation = ControlOperation.Recover,
            CorrelationId = recoverId,
            ExpectedComponents = opts.ExpectedComponents,
            AcksReceived = [],
            StartedAt = now,
            DeadlineAt = now.AddSeconds(opts.AckTimeoutSeconds),
            RecoverSince = since,
        };

    private static ControlStreamEvent BuildInitiatedEvent(Guid recoverId, DateTimeOffset now) =>
        new()
        {
            Id = recoverId, // Per spec: recover-initiated event id IS the correlation_id carried by others.
            Type = "recover-initiated",
            Component = "*",
            // recover-initiated carries its own id as correlation_id; downstream frames echo it.
            CorrelationId = recoverId,
            OccurredAt = now,
        };
}
