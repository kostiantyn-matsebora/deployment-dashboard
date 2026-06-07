using System.Runtime.CompilerServices;
using System.Text;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Control;

/// <summary>
/// HTTP-streaming subscriber for <c>GET /api/control/stream</c> (§5.10.2).
/// Uses <c>HttpCompletionOption.ResponseHeadersRead</c> — NOT <c>EventSource</c> —
/// because custom headers (<c>X-Control-API-Key</c>) are required.
/// </summary>
public sealed class ControlStreamClient(
    HttpClient http,
    ILogger<ControlStreamClient> logger) : IControlStreamClient
{
    private const string ComponentParam = "dashboard-fetcher";

    public async IAsyncEnumerable<ParsedSseEvent> StreamAsync(
        string? lastEventId,
        [EnumeratorCancellation] CancellationToken ct)
    {
        var url = $"/api/control/stream?component={ComponentParam}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        if (!string.IsNullOrEmpty(lastEventId))
            request.Headers.Add("Last-Event-ID", lastEventId);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                ct);
            response.EnsureSuccessStatusCode();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "[ControlStream] Failed to open control stream; will reconnect");
            yield break;
        }

        // ReadBodyAsync is a separate (non-iterator) method so disposal of response/stream
        // can use conventional `using` blocks without hitting iterator-embedded-statement limits.
        await foreach (var ev in ReadBodyAsync(response, ct))
            yield return ev;
    }

    private async IAsyncEnumerable<ParsedSseEvent> ReadBodyAsync(
        HttpResponseMessage response,
        [EnumeratorCancellation] CancellationToken ct)
    {
        using var _ = response;
        var stream = await response.Content.ReadAsStreamAsync(ct);
        await using var __ = stream;
        using var reader = new StreamReader(stream);

        string? frameId = null;
        string? frameEvent = null;
        var dataLines = new StringBuilder();

        while (!ct.IsCancellationRequested)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync(ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "[ControlStream] Read error; signalling reconnect");
                yield break;
            }

            if (line is null)
            {
                // EOF — server closed the connection; caller will reconnect.
                logger.LogInformation("[ControlStream] Server closed the stream");
                yield break;
            }

            // ": ping" — heartbeat comment; reset idle timer, no event dispatch (§5.10.2).
            if (line.StartsWith(':'))
            {
                yield return new ParsedSseEvent(IsPing: true, Id: null, EventType: null, Data: null);
                continue;
            }

            // Blank line = frame boundary.
            if (line.Length == 0)
            {
                if (frameEvent is not null || dataLines.Length > 0)
                {
                    var data = dataLines.Length > 0 ? dataLines.ToString() : null;
                    yield return new ParsedSseEvent(
                        IsPing: false,
                        Id: frameId,
                        EventType: frameEvent,
                        Data: data);
                }

                frameId = null;
                frameEvent = null;
                dataLines.Clear();
                continue;
            }

            // Field lines.
            ParseFieldLine(line, ref frameId, ref frameEvent, dataLines);
        }
    }

    // Parse a non-empty, non-comment SSE field line and update the current frame state.
    // Other field names (retry: etc.) — silently ignored (forward-compat).
    private static void ParseFieldLine(
        string line,
        ref string? frameId,
        ref string? frameEvent,
        StringBuilder dataLines)
    {
        if (line.StartsWith("id:", StringComparison.Ordinal))
            frameId = line["id:".Length..].TrimStart();
        else if (line.StartsWith("event:", StringComparison.Ordinal))
            frameEvent = line["event:".Length..].TrimStart();
        else if (line.StartsWith("data:", StringComparison.Ordinal))
        {
            if (dataLines.Length > 0)
                dataLines.Append('\n');
            dataLines.Append(line["data:".Length..].TrimStart());
        }
    }
}
