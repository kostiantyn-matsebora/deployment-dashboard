using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
using Dashboard.Control.Repositories;
using Dashboard.Control.StateMachine;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Dashboard.Control.Services;

/// <summary>
/// Handles <c>POST /api/control/reset</c>:
/// <list type="bullet">
///   <item>Checks for an in-flight cycle; returns <c>null</c> (→ 409) if one exists.</item>
///   <item>Transitions idle → draining, persists the cycle row, emits <c>reset-initiated</c>.</item>
///   <item>Returns <see cref="ResetAcceptance"/> (→ 202) immediately.</item>
///   <item>Fires the background orchestrator on the thread pool (non-blocking).</item>
/// </list>
/// </summary>
internal sealed class ResetService(
    IResetCycleRepository cycleRepository,
    IControlStreamRepository controlStream,
    IControlEventNotifier notifier,
    IResetOrchestrator orchestrator,
    IOptions<ResetOptions> options,
    ILogger<ResetService> logger) : IResetService
{
    public async Task<ResetAcceptance?> TryInitiateAsync(CancellationToken ct = default)
    {
        var cycle = await cycleRepository.LoadAsync(ct);
        if (cycle.State != ResetState.Idle)
        {
            logger.LogInformation("Reset already in flight (state={State}); returning 409.", cycle.State);
            return null;
        }

        var opts = options.Value;
        var resetId = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;

        cycle.State = ResetState.Draining;
        cycle.ResetId = resetId;
        cycle.ExpectedComponents = opts.ExpectedComponents;
        cycle.AcksReceived = [];
        cycle.StartedAt = now;
        cycle.DeadlineAt = now.AddSeconds(opts.AckTimeoutSeconds);

        // Persist draining state + emit reset-initiated before returning 202.
        await cycleRepository.SaveAsync(cycle, ct);

        var initiatedEvent = new ControlStreamEvent
        {
            Id = resetId, // Per spec: the id of reset-initiated IS the reset_id correlated by others.
            Type = "reset-initiated",
            Component = "*",
            OccurredAt = now,
        };
        await controlStream.InsertAsync(initiatedEvent, ct);
        await notifier.NotifyAsync(initiatedEvent, ct);

        logger.LogInformation("Reset initiated: reset_id={ResetId}.", resetId);

        // Fire-and-forget the orchestrator on the thread pool.
        // AppStopping cancellation is handled inside the orchestrator.
        _ = Task.Run(() => orchestrator.DriveAsync(resetId, opts, CancellationToken.None));

        return new ResetAcceptance(resetId, ResetState.Draining, now);
    }
}
