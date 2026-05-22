using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Dashboard.Integration.Tests;

/// <summary>
/// Long-lived SSE client for <c>GET /api/stream</c>. The listener opens
/// the stream once on construction (Phase 1 of every assertion is "open
/// the stream BEFORE the trigger so we don't race the event into the
/// void" — same pattern as <c>Dashboard.Functional.Tests.SseRefShaTests</c>),
/// then exposes:
/// <list type="bullet">
///   <item><see cref="WaitForFrameAsync"/> — block until the next data
///   frame satisfying a caller-supplied predicate arrives, or the budget
///   expires.</item>
///   <item><see cref="CountFramesAsync"/> — accumulate matching frames
///   over a wall-clock window. Used by the box-state tests to assert one
///   SSE event per seeded deployment.</item>
/// </list>
///
/// <para>The listener does not parse the SSE envelope per the W3C spec
/// (no multi-line data accumulation, no event-id tracking) — the
/// dashboard emits single-line <c>data:</c> frames only (one JSON blob
/// per line). If the SSE wire shape ever evolves, this listener needs to
/// re-implement event accumulation.</para>
/// </summary>
public sealed class SseListener : IAsyncDisposable
{
    private readonly HttpClient _http;
    private readonly HttpRequestMessage _req;
    private readonly HttpResponseMessage _resp;
    private readonly Stream _body;
    private readonly StreamReader _reader;
    private readonly bool _ownsHttp;

    private SseListener(HttpClient http, HttpRequestMessage req, HttpResponseMessage resp, Stream body, StreamReader reader, bool ownsHttp)
    {
        _http = http;
        _req = req;
        _resp = resp;
        _body = body;
        _reader = reader;
        _ownsHttp = ownsHttp;
    }

    /// <summary>
    /// Open the stream and return a ready-to-read listener.
    /// </summary>
    public static async Task<SseListener> OpenAsync(CancellationToken ct = default)
    {
        var http = new HttpClient
        {
            BaseAddress = new Uri(TestEnvironment.ReadBaseUrl),
            Timeout = Timeout.InfiniteTimeSpan, // SSE is open-ended.
        };
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/stream");
        req.Headers.Accept.Clear();
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));

        HttpResponseMessage resp;
        try
        {
            resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        catch
        {
            http.Dispose();
            req.Dispose();
            throw;
        }

        if (resp.StatusCode != HttpStatusCode.OK)
        {
            resp.Dispose();
            http.Dispose();
            req.Dispose();
            throw new InvalidOperationException(
                $"GET /api/stream returned {(int)resp.StatusCode} (expected 200). " +
                "Verify the integration stack is up and the SSE listener is healthy.");
        }

        var body = await resp.Content.ReadAsStreamAsync(ct);
        var reader = new StreamReader(body, Encoding.UTF8);
        return new SseListener(http, req, resp, body, reader, ownsHttp: true);
    }

    /// <summary>
    /// Read SSE lines until a <c>data:</c> frame parses as JSON AND
    /// satisfies <paramref name="predicate"/>, or <paramref name="budget"/>
    /// expires. Returns the raw JSON envelope as parsed
    /// <see cref="JsonDocument"/> on match, or <c>null</c> on timeout.
    /// Heartbeat / non-JSON frames are skipped.
    /// </summary>
    public async Task<JsonDocument?> WaitForFrameAsync(
        Func<JsonElement, bool> predicate, TimeSpan budget, CancellationToken outer = default)
    {
        var deadline = DateTime.UtcNow + budget;
        while (DateTime.UtcNow < deadline && !outer.IsCancellationRequested)
        {
            var line = await ReadLineWithTimeoutAsync(deadline - DateTime.UtcNow, outer);
            if (line is null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var payload = line["data:".Length..].TrimStart();
            if (string.IsNullOrEmpty(payload)) continue;

            JsonDocument? doc;
            try { doc = JsonDocument.Parse(payload); }
            catch (JsonException) { continue; /* heartbeat / non-JSON */ }

            if (predicate(doc.RootElement)) return doc;
            doc.Dispose();
        }
        return null;
    }

    /// <summary>
    /// Count SSE data frames satisfying <paramref name="predicate"/> within
    /// the wall-clock window <paramref name="budget"/>. Returns when the
    /// budget expires (does NOT short-circuit on first match) — callers
    /// can therefore assert "exactly N frames arrived". The predicate
    /// receives each parsed envelope's root.
    /// </summary>
    public async Task<int> CountFramesAsync(
        Func<JsonElement, bool> predicate, TimeSpan budget, CancellationToken outer = default)
    {
        var deadline = DateTime.UtcNow + budget;
        var count = 0;
        while (DateTime.UtcNow < deadline && !outer.IsCancellationRequested)
        {
            var line = await ReadLineWithTimeoutAsync(deadline - DateTime.UtcNow, outer);
            if (line is null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var payload = line["data:".Length..].TrimStart();
            if (string.IsNullOrEmpty(payload)) continue;

            try
            {
                using var doc = JsonDocument.Parse(payload);
                if (predicate(doc.RootElement)) count++;
            }
            catch (JsonException) { /* heartbeat */ }
        }
        return count;
    }

    /// <summary>
    /// Accumulate matching SSE frames into a list (full envelope payload
    /// preserved as JSON text) over the wall-clock window. Used when the
    /// caller wants both the count AND the bodies (e.g. for cursor-contract
    /// negative assertions: "no event whose deployment_id appears in the
    /// first tick fires on the second tick").
    /// </summary>
    public async Task<IReadOnlyList<string>> CollectFramesAsync(
        Func<JsonElement, bool> predicate, TimeSpan budget, CancellationToken outer = default)
    {
        var deadline = DateTime.UtcNow + budget;
        var collected = new List<string>();
        while (DateTime.UtcNow < deadline && !outer.IsCancellationRequested)
        {
            var line = await ReadLineWithTimeoutAsync(deadline - DateTime.UtcNow, outer);
            if (line is null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var payload = line["data:".Length..].TrimStart();
            if (string.IsNullOrEmpty(payload)) continue;

            try
            {
                using var doc = JsonDocument.Parse(payload);
                if (predicate(doc.RootElement)) collected.Add(payload);
            }
            catch (JsonException) { /* heartbeat */ }
        }
        return collected;
    }

    public async ValueTask DisposeAsync()
    {
        _reader.Dispose();
        await _body.DisposeAsync();
        _resp.Dispose();
        _req.Dispose();
        if (_ownsHttp) _http.Dispose();
    }

    private async Task<string?> ReadLineWithTimeoutAsync(TimeSpan budget, CancellationToken outer)
    {
        if (budget <= TimeSpan.Zero) return null;
        using var lineCts = CancellationTokenSource.CreateLinkedTokenSource(outer);
        lineCts.CancelAfter(budget);
        try
        {
            return await _reader.ReadLineAsync(lineCts.Token).AsTask();
        }
        catch (OperationCanceledException) when (!outer.IsCancellationRequested)
        {
            return null;
        }
    }
}
