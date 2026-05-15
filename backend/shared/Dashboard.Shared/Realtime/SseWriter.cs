using System.Text;
using System.Text.Json;
using Dashboard.Shared.Json;

namespace Dashboard.Shared.Realtime;

/// <summary>
/// Pure formatter for SSE wire frames. Format per SAD §7 Real-time path:
/// <code>
/// id: &lt;monotonic&gt;
/// event: slot-update
/// data: &lt;json&gt;
/// &lt;blank line&gt;
/// </code>
/// Exposed as a static helper so unit tests can validate the byte layout
/// without a live HTTP response.
/// </summary>
public static class SseWriter
{
    public const string SlotUpdateEventName = "slot-update";

    /// <summary>
    /// Format a single SSE frame. Multi-line JSON payloads are intentionally
    /// not handled — System.Text.Json's default writer never inserts raw
    /// newlines into the encoded payload.
    /// </summary>
    public static byte[] FormatFrame(SlotUpdate update)
    {
        // SAD §7 "SSE slot-update data payload": the wire shape is the
        // wrapped { service, environment, state } object, NOT the raw
        // deployment event. The Read API derives `state` per slot before
        // publishing so SPA clients can apply the patch without re-deriving
        // lastSuccessful / previousFailed.
        var json = JsonSerializer.Serialize(update.Payload, DashboardJson.Options);
        var sb = new StringBuilder(json.Length + 64);
        sb.Append("id: ").Append(update.Id).Append('\n');
        sb.Append("event: ").Append(SlotUpdateEventName).Append('\n');
        sb.Append("data: ").Append(json).Append('\n');
        sb.Append('\n');
        return Encoding.UTF8.GetBytes(sb.ToString());
    }

    /// <summary>
    /// Format a comment heartbeat. SSE comments are lines beginning with a
    /// colon; they keep the connection alive without delivering an event.
    /// </summary>
    public static byte[] FormatHeartbeat() =>
        Encoding.UTF8.GetBytes(": heartbeat\n\n");

    /// <summary>
    /// Parse a browser-supplied <c>Last-Event-ID</c> header (or query string)
    /// into the numeric id space used by the broker. Returns 0 (equivalent
    /// to "send everything") on bad input — the SSE spec doesn't define
    /// strict semantics here.
    /// </summary>
    public static long ParseLastEventId(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return 0;
        return long.TryParse(raw, out var n) && n > 0 ? n : 0;
    }
}
