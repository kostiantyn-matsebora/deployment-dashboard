using System.Threading.Channels;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Sse;

/// <summary>
/// Fan-out hub for control-stream events. Mirrors <c>IDeploymentEventBroadcaster</c>.
/// One singleton serves every open <c>GET /api/control/stream</c> response.
/// </summary>
public interface IControlEventBroadcaster
{
    /// <summary>Registers a new subscriber and returns its channel reader.</summary>
    ChannelReader<ControlStreamEvent> Subscribe();

    /// <summary>Removes a subscriber and completes its channel.</summary>
    void Unsubscribe(ChannelReader<ControlStreamEvent> reader);
}
