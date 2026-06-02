using System.Threading.Channels;
using Dashboard.Control.Models;

namespace Dashboard.Control.Sse;

/// <summary>
/// Fan-out hub for live component events received via PostgreSQL LISTEN/NOTIFY on
/// the <c>component_events</c> channel. Mirrors <c>IDeploymentEventBroadcaster</c>.
/// One singleton serves every open <c>GET /api/control/events/stream</c> response.
/// </summary>
public interface IComponentEventBroadcaster
{
    /// <summary>Registers a new subscriber and returns its channel reader.</summary>
    ChannelReader<ComponentEventRecord> Subscribe();

    /// <summary>Removes a subscriber and completes its channel.</summary>
    void Unsubscribe(ChannelReader<ComponentEventRecord> reader);
}
