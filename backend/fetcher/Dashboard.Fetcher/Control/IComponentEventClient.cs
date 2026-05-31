namespace Dashboard.Fetcher.Control;

/// <summary>
/// Posts operational events to <c>POST /api/control/events</c> (§5.10.4, §5.10.5).
/// </summary>
public interface IComponentEventClient
{
    /// <summary>Posts a <c>reset-ack</c> event correlating to <paramref name="resetId"/>.</summary>
    Task PostAckAsync(string resetId, CancellationToken ct);

    /// <summary>Posts a <c>status</c> / <c>running</c> event after recovery (§5.10.5).</summary>
    Task PostRunningAsync(string resetId, CancellationToken ct);
}
