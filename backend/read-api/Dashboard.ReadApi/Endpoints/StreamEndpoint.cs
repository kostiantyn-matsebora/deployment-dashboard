using Dashboard.Shared.Realtime;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.ReadApi.Endpoints;

/// <summary>
/// /api/stream — Server-Sent Events for slot updates (SAD §7 Real-time path).
///
/// <para>The endpoint:</para>
/// <list type="number">
///   <item>Sets <c>text/event-stream</c>, disables response buffering, and
///   flushes after every write.</item>
///   <item>Honours <c>Last-Event-ID</c> (header or query string) for
///   best-effort replay from the broker's ring buffer.</item>
///   <item>Subscribes to the in-process <see cref="SlotUpdateBroker"/> for
///   live events forwarded by <see cref="DeploymentListener"/>.</item>
///   <item>Emits a heartbeat comment every 15s so intermediaries don't
///   close the long-lived connection.</item>
/// </list>
/// </summary>
public static class StreamEndpoint
{
    private static readonly TimeSpan HeartbeatInterval = TimeSpan.FromSeconds(15);

    public static void Map(IEndpointRouteBuilder app)
    {
        app.MapGet("/api/stream", async (HttpContext ctx, SlotUpdateBroker broker, CancellationToken ct) =>
        {
            ctx.Response.Headers["Cache-Control"] = "no-cache, no-transform";
            ctx.Response.Headers["X-Accel-Buffering"] = "no"; // reverse-proxy friendly
            ctx.Response.ContentType = "text/event-stream";

            // Disable response buffering so the first heartbeat reaches
            // the client immediately.
            var bufferingFeature = ctx.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpResponseBodyFeature>();
            bufferingFeature?.DisableBuffering();

            var lastEventIdHeader = ctx.Request.Headers["Last-Event-ID"].ToString();
            var lastEventIdQuery = ctx.Request.Query["last-event-id"].ToString();
            var lastEventId = SseWriter.ParseLastEventId(
                !string.IsNullOrWhiteSpace(lastEventIdHeader) ? lastEventIdHeader : lastEventIdQuery);

            // Replay anything still in the ring buffer first so a quick
            // reconnect doesn't lose an event between disconnect and
            // re-subscribe.
            foreach (var missed in broker.ReplaySince(lastEventId))
            {
                await ctx.Response.Body.WriteAsync(SseWriter.FormatFrame(missed), ct);
            }
            await ctx.Response.Body.FlushAsync(ct);

            using var subscription = broker.Subscribe();
            var heartbeat = new PeriodicTimer(HeartbeatInterval);

            try
            {
                var readTask = subscription.Reader.WaitToReadAsync(ct).AsTask();
                var heartbeatTask = heartbeat.WaitForNextTickAsync(ct).AsTask();

                while (!ct.IsCancellationRequested)
                {
                    var completed = await Task.WhenAny(readTask, heartbeatTask);

                    if (completed == heartbeatTask)
                    {
                        if (!await heartbeatTask) break;
                        await ctx.Response.Body.WriteAsync(SseWriter.FormatHeartbeat(), ct);
                        await ctx.Response.Body.FlushAsync(ct);
                        heartbeatTask = heartbeat.WaitForNextTickAsync(ct).AsTask();
                        continue;
                    }

                    // readTask completed
                    if (!await readTask) break;
                    while (subscription.Reader.TryRead(out var update))
                    {
                        await ctx.Response.Body.WriteAsync(SseWriter.FormatFrame(update), ct);
                    }
                    await ctx.Response.Body.FlushAsync(ct);
                    readTask = subscription.Reader.WaitToReadAsync(ct).AsTask();
                }
            }
            catch (OperationCanceledException) { /* client disconnected */ }
        })
        .WithName("StreamSlotUpdates")
        .WithTags("Read")
        .WithSummary("Server-Sent Events stream of slot updates")
        .WithDescription(
            "Long-lived text/event-stream connection that emits one 'slot-update' event " +
            "per persisted deployment (NFR-03). Honours Last-Event-ID (header OR " +
            "?last-event-id query param) for best-effort replay from the in-process ring " +
            "buffer. Heartbeat comment every 15s keeps reverse proxies from closing the " +
            "connection. Payload schema: see Dashboard.Shared.Dto.SlotUpdatePayload.")
        .Produces(StatusCodes.Status200OK, contentType: "text/event-stream");
    }
}
