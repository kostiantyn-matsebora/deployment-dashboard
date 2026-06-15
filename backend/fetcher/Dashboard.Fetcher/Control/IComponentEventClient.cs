using Dashboard.Fetcher.Orchestration;

namespace Dashboard.Fetcher.Control;

/// <summary>
/// Posts operational events to <c>POST /api/control/events</c> (§5.10.4, §5.10.5, F18).
/// </summary>
public interface IComponentEventClient
{
    /// <summary>Posts a <c>reset-ack</c> event correlating to <paramref name="resetId"/>.</summary>
    Task PostAckAsync(string resetId, CancellationToken ct);

    /// <summary>Posts a <c>status</c> / <c>running</c> event after recovery (§5.10.5).</summary>
    Task PostRunningAsync(string resetId, CancellationToken ct);

    /// <summary>
    /// Posts a <c>rate-limit</c> component event after each poll cycle (F18 / §5.11).
    /// Non-fatal: transport errors and non-2xx responses are logged and swallowed.
    /// </summary>
    /// <param name="snapshot">Current rate-limit snapshot from the poll cycle.</param>
    /// <param name="adapterId">Adapter that produced the snapshot (e.g. <c>"github-actions"</c>).</param>
    /// <param name="state">Component state string (e.g. <c>"running"</c> or <c>"paused"</c>).</param>
    /// <param name="ct">Cancellation token.</param>
    Task PostRateLimitAsync(RateLimitSnapshot snapshot, string adapterId, string state, CancellationToken ct);
}
