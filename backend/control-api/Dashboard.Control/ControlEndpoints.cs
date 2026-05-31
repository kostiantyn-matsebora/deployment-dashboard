using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Control.Filters;
using Dashboard.Control.Models;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Queries;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Control.Sse;
using Dashboard.Control.Validation;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Control;

public static class ControlEndpoints
{
    /// <summary>Max serialised <c>payload</c> size (8 KiB) — exceeding it yields <c>413</c>.</summary>
    private const int MaxPayloadBytes = 8192;

    // Snake_case + null-omit — must match the global HttpJsonOptions set in Program.cs.
    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static IEndpointRouteBuilder MapControlEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/control/reset", HandleResetAsync)
           .AddEndpointFilter<ControlApiKeyEndpointFilter>()
           .WithName("Reset")
           .WithTags("Control")
           .WithSummary("Initiate an asynchronous system-state reset")
           .Produces<ResetAcceptedResponse>(StatusCodes.Status202Accepted)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status409Conflict);

        app.MapGet("/api/control/stream", HandleStreamAsync)
           .AddEndpointFilter<ControlApiKeyEndpointFilter>()
           .WithName("WatchControlStream")
           .WithTags("Control")
           .WithSummary("SSE stream of orchestration events emitted to components")
           .Produces(StatusCodes.Status200OK)
           .ProducesProblem(StatusCodes.Status401Unauthorized);

        app.MapPost("/api/control/events", HandlePostEventAsync)
           .AddEndpointFilter<ApiKeyEndpointFilter>()
           .AddEndpointFilter<ComponentEventValidationEndpointFilter>()
           .WithName("PostComponentEvent")
           .WithTags("Control")
           .WithSummary("A component posts an operational event")
           .Produces(StatusCodes.Status204NoContent)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status413RequestEntityTooLarge)
           .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

        app.MapGet("/api/control/events", HandleListEventsAsync)
           .WithName("ListComponentEvents")
           .WithTags("Control")
           .WithSummary("List component-posted events with cursor pagination")
           .Produces<ComponentEventPage>(StatusCodes.Status200OK);

        return app;
    }

    // ── POST /api/control/reset ───────────────────────────────────────────────

    private static async Task<IResult> HandleResetAsync(
        IResetService resetService,
        CancellationToken ct)
    {
        var acceptance = await resetService.TryInitiateAsync(ct);

        if (acceptance is null)
            return Results.Problem(
                title: "A reset is already in progress.",
                detail: "Only one reset may be in flight at a time. Wait for the current reset to complete.",
                statusCode: StatusCodes.Status409Conflict);

        return Results.Accepted(value: new ResetAcceptedResponse(
            acceptance.ResetId,
            acceptance.State,
            acceptance.AcceptedAt));
    }

    // ── POST /api/control/events ──────────────────────────────────────────────

    private static async Task<IResult> HandlePostEventAsync(
        [FromBody] ComponentEventIngest body,
        [FromHeader(Name = "X-Component-Id")] string? componentId,
        IComponentEventRepository repository,
        IComponentAckNotifier ackNotifier,
        CancellationToken ct)
    {
        // The validation filter has already guaranteed a valid X-Component-Id before this runs;
        // the parameter is nullable only so a missing header reaches the filter (→ 422, not 400).
        ArgumentException.ThrowIfNullOrEmpty(componentId);

        // Payload is stored verbatim; reject when its serialised size exceeds the limit (413).
        string? payloadJson = null;
        if (body.Payload is { } payload)
        {
            payloadJson = payload.GetRawText();
            if (Encoding.UTF8.GetByteCount(payloadJson) > MaxPayloadBytes)
                return Results.Problem(
                    title: "Payload exceeds the size limit.",
                    detail: $"The payload must not exceed {MaxPayloadBytes} bytes when serialised.",
                    statusCode: StatusCodes.Status413RequestEntityTooLarge);
        }

        var entity = new ComponentEvent
        {
            Id = Guid.CreateVersion7(),
            ComponentId = componentId,
            EventType = body.EventType,
            State = body.State,
            Detail = body.Detail,
            OccurredAt = body.OccurredAt,
            ReceivedAt = DateTimeOffset.UtcNow,
            Payload = payloadJson,
        };

        await repository.InsertAsync(entity, ct);

        // For reset-ack events, NOTIFY the component_acks channel so the driving reset instance
        // can count this ack for the active cycle (§7 ch.3, D16).
        if (body.EventType == "reset-ack" && ExtractResetId(body) is { } resetId)
            await ackNotifier.NotifyAsync(componentId, resetId, ct);

        return Results.NoContent();
    }

    // ── GET /api/control/events ───────────────────────────────────────────────

    private static async Task<IResult> HandleListEventsAsync(
        [FromQuery(Name = "component_id")] string? componentId,
        [FromQuery(Name = "event_type")] string? eventType,
        [FromQuery] DateTimeOffset? since,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        IComponentEventRepository repository,
        CancellationToken ct)
    {
        var query = new ComponentEventListQuery(
            ComponentId: componentId,
            EventType: eventType,
            Since: since,
            Cursor: cursor,
            Limit: Math.Clamp(limit ?? 50, 1, 200));

        var (items, nextCursor) = await repository.ListAsync(query, ct);
        return Results.Ok(new ComponentEventPage(items, nextCursor));
    }

    // ── GET /api/control/stream (SSE) ─────────────────────────────────────────

    /// <summary>
    /// Streams control orchestration events as Server-Sent Events.
    /// Replays <c>id &gt; Last-Event-ID</c> from <c>control_stream_events</c> (2 h window), then
    /// attaches to the live channel. Emits <c>: ping</c> every 15 s and filters by <c>?component=</c>.
    /// Mirrors the deployment SSE handler.
    /// </summary>
    private static async Task HandleStreamAsync(
        [FromHeader(Name = "Last-Event-ID")] string? lastEventId,
        [FromQuery] string? component,
        IControlEventBroadcaster broadcaster,
        IControlStreamRepository repository,
        HttpContext httpContext,
        CancellationToken ct)
    {
        httpContext.Response.ContentType = "text/event-stream";
        httpContext.Response.Headers.CacheControl = "no-cache";
        httpContext.Response.Headers.Connection = "keep-alive";
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";

        await httpContext.Response.Body.FlushAsync(ct);

        // Replay missed events when a component reconnects with Last-Event-ID.
        if (Guid.TryParse(lastEventId, out var resumeId))
        {
            var missed = await repository.GetSinceAsync(resumeId, component, ct);
            foreach (var ev in missed)
                await WriteSseEventAsync(httpContext, ev, ct);
        }

        var reader = broadcaster.Subscribe();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                using var heartbeatCts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, heartbeatCts.Token);

                bool hasData;
                try
                {
                    hasData = await reader.WaitToReadAsync(linked.Token);
                }
                catch (OperationCanceledException) when (heartbeatCts.IsCancellationRequested && !ct.IsCancellationRequested)
                {
                    await WriteSsePingAsync(httpContext, ct);
                    continue;
                }

                if (!hasData) break; // channel completed (broadcaster shutting down)

                while (reader.TryRead(out var ev))
                {
                    if (component is null || ev.Component == component || ev.Component == "*")
                        await WriteSseEventAsync(httpContext, ev, ct);
                }
            }
        }
        finally
        {
            broadcaster.Unsubscribe(reader);
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static async Task WriteSseEventAsync(
        HttpContext httpContext,
        ControlStreamEvent ev,
        CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(ev, SseJsonOptions);
        var frame = $"id: {ev.Id}\nevent: {ev.Type}\ndata: {json}\n\n";
        await httpContext.Response.WriteAsync(frame, ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    private static async Task WriteSsePingAsync(HttpContext httpContext, CancellationToken ct)
    {
        await httpContext.Response.WriteAsync(": ping\n\n", ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    /// <summary>
    /// Extracts <c>reset_id</c> from the opaque payload of a <c>reset-ack</c> event.
    /// The payload is an already-serialised JSON string stored verbatim; parse it minimally.
    /// </summary>
    private static string? ExtractResetId(ComponentEventIngest body)
    {
        if (body.Payload is not { } payload) return null;

        try
        {
            return payload.TryGetProperty("reset_id", out var prop)
                ? prop.GetString()
                : null;
        }
        catch
        {
            return null;
        }
    }
}
