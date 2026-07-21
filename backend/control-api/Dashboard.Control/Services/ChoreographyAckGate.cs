using Dashboard.Control.Options;
using Dashboard.Control.Sse;
using Dashboard.Shared.Entities;
using Microsoft.Extensions.Logging;

namespace Dashboard.Control.Services;

/// <summary>
/// The draining-phase ack-drain/wait loop — operation-agnostic saga plumbing shared by
/// <see cref="ResetOrchestrator"/> and <see cref="RecoverOrchestrator"/>. Waits for every
/// expected component to ack (persisting <c>reset_cycle.acks_received</c> after each new ack via
/// <see cref="ChoreographyCycleStore"/>) or for the ack/gate-max deadline, whichever comes first
/// (D13).
/// </summary>
internal static class ChoreographyAckGate
{
    public static async Task WaitForAcksOrTimeoutAsync(
        ComponentAcksBroadcaster acksBroadcaster,
        ChoreographyIdentity identity,
        ChoreographyCycleContext cycleCtx,
        ResetCycle cycle,
        ChoreographyDeadlines deadlines,
        ResetOptions options,
        CancellationToken ct)
    {
        var expectedComponents = cycle.ExpectedComponents ?? options.ExpectedComponents;
        var acksReceived = new HashSet<string>(cycle.AcksReceived ?? [], StringComparer.Ordinal);

        if (acksReceived.IsSupersetOf(expectedComponents))
            return;

        var ackWait = TimeSpan.FromMilliseconds(
            Math.Max(0, (deadlines.AckDeadline - DateTimeOffset.UtcNow).TotalMilliseconds));
        var gateWait = TimeSpan.FromMilliseconds(
            Math.Max(0, (deadlines.GateMaxDeadline - DateTimeOffset.UtcNow).TotalMilliseconds));
        var waitCap = ackWait < gateWait ? ackWait : gateWait;

        using var timeoutCts = new CancellationTokenSource(waitCap);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeoutCts.Token);

        try
        {
            while (await acksBroadcaster.AckReader.WaitToReadAsync(linked.Token))
            {
                if (await DrainAckBatchAsync(acksBroadcaster, identity, cycleCtx, cycle, acksReceived, expectedComponents, ct))
                    return;
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            // Inner ack-wait timeout elapsed; proceed with however many acks arrived.
            identity.Logger.LogInformation(
                "{Operation} orchestrator: ack timeout elapsed for correlation_id {CorrelationId}; proceeding with {Count}/{Total} acks.",
                identity.OperationLabel, cycle.CorrelationId, acksReceived.Count, expectedComponents.Length);
        }
    }

    /// <summary>
    /// Drains all pending acks from <see cref="ComponentAcksBroadcaster.AckReader"/> into
    /// <paramref name="acksReceived"/>, persists the cycle after each new ack, and returns
    /// <c>true</c> once all expected components have acknowledged.
    /// </summary>
    private static async Task<bool> DrainAckBatchAsync(
        ComponentAcksBroadcaster acksBroadcaster,
        ChoreographyIdentity identity,
        ChoreographyCycleContext cycleCtx,
        ResetCycle cycle,
        HashSet<string> acksReceived,
        string[] expectedComponents,
        CancellationToken ct)
    {
        while (acksBroadcaster.AckReader.TryRead(out var ack))
        {
            if (!Guid.TryParse(ack.CorrelationId, out var ackCorrelationId) || ackCorrelationId != cycle.CorrelationId)
                continue;

            if (acksReceived.Add(ack.ComponentId))
            {
                cycle.AcksReceived = [.. acksReceived];
                await ChoreographyCycleStore.SaveAsync(cycleCtx, cycle, ct);
                identity.Logger.LogInformation(
                    "{Operation} orchestrator: ack received from {ComponentId} ({Count}/{Total}).",
                    identity.OperationLabel, ack.ComponentId, acksReceived.Count, expectedComponents.Length);
            }

            if (acksReceived.IsSupersetOf(expectedComponents))
                return true;
        }

        return false;
    }
}
