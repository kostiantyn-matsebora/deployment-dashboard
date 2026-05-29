using System.Threading.Channels;
using Dashboard.Shared.Entities;

namespace Dashboard.Read.Sse;

/// <summary>
/// Fan-out hub for live deployment events received via PostgreSQL LISTEN/NOTIFY.
/// Each open SSE connection subscribes a dedicated channel reader; the broadcaster
/// writes every incoming event to all registered readers.
/// </summary>
internal interface IDeploymentEventBroadcaster
{
    /// <summary>
    /// Registers a new subscriber and returns the reader end of a dedicated bounded channel.
    /// The caller MUST call <see cref="Unsubscribe"/> when the SSE connection closes.
    /// </summary>
    ChannelReader<DeploymentEvent> Subscribe();

    /// <summary>Deregisters the subscriber and completes its channel so the reader exits cleanly.</summary>
    void Unsubscribe(ChannelReader<DeploymentEvent> reader);
}
