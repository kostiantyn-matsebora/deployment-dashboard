using System.Diagnostics.CodeAnalysis;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using System.Text.Json.Serialization;
using Dashboard.Control.Filters;
using Dashboard.Control.Models;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Options;
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
using Microsoft.Extensions.Options;

namespace Dashboard.Control;

// S1200: An endpoint-mapping surface class necessarily references every route handler,
// filter, model, notifier, repository, and SSE type it maps — coupling is inherent
// to the pattern and cannot be reduced without fragmenting the routing surface.
[SuppressMessage("SonarAnalyzer", "S1200", Justification = "Endpoint-mapping surface: coupling to all handler dependencies is inherent and irreducible.")]
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

        app.MapPost("/api/control/recover", HandleRecoverAsync)
           .AddEndpointFilter<ControlApiKeyEndpointFilter>()
           .WithName("Recover")
           .WithTags("Control")
           .WithSummary("Initiate an asynchronous, non-destructive recovery")
           .Produces<RecoverAcceptedResponse>(StatusCodes.Status202Accepted)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status409Conflict)
           .ProducesProblem(StatusCodes.Status422UnprocessableEntity);

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

        app.MapGet("/api/control/events/stream", HandleComponentEventStreamAsync)
           .WithName("watchComponentEventStream")
           .WithTags("Control")
           .WithSummary("SSE stream of component-reported events")
           .Produces(StatusCodes.Status200OK);

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
            acceptance.CorrelationId,
            acceptance.State,
            acceptance.AcceptedAt));
    }

    // ── POST /api/control/recover ─────────────────────────────────────────────

    private static async Task<IResult> HandleRecoverAsync(
        [FromBody] RecoverRequest body,
        IRecoverService recoverService,
        IOptions<ResetOptions> resetOptions,
        CancellationToken ct)
    {
        var (since, validationError) = ResolveRecoverSince(body, resetOptions.Value);
        if (validationError is not null)
            return validationError;

        var acceptance = await recoverService.TryInitiateAsync(since!.Value, ct);

        if (acceptance is null)
            return Results.Problem(
                title: "A control operation is already in progress.",
                detail: "Only one reset or recover may be in flight at a time. Wait for the current operation to complete.",
                statusCode: StatusCodes.Status409Conflict);

        return Results.Accepted(value: new RecoverAcceptedResponse(
            acceptance.CorrelationId,
            acceptance.State,
            acceptance.Since,
            acceptance.AcceptedAt));
    }

    /// <summary>
    /// Enforces the <c>since</c> XOR <c>days_back</c> rule, bounds both fields to
    /// <see cref="ResetOptions.RecoverMaxDaysBack"/>, and resolves <c>days_back</c> to an absolute
    /// <c>since = now − days_back days</c>. Returns a <c>422</c> Problem when neither or both
    /// fields are supplied, when <c>days_back</c> is not in <c>[1, RecoverMaxDaysBack]</c>, or when
    /// an absolute <c>since</c> is older than <c>now - RecoverMaxDaysBack days</c>.
    ///
    /// The bound checks run BEFORE any <see cref="DateTimeOffset.AddDays(double)"/> call: an
    /// unbounded <c>days_back</c> (e.g. <see cref="int.MaxValue"/>) would otherwise overflow
    /// <c>AddDays</c> into an uncaught <see cref="ArgumentOutOfRangeException"/> (→ 500), and an
    /// unbounded in-range <c>days_back</c>/`since` would otherwise force the fetcher into an
    /// unbounded re-poll. Both failure modes are rejected with the same 422 Problem as the
    /// pre-existing `days_back &gt;= 1` check.
    /// </summary>
    private static (DateTimeOffset? since, IResult? error) ResolveRecoverSince(RecoverRequest body, ResetOptions options)
    {
        var hasSince = body.Since is not null;
        var hasDaysBack = body.DaysBack is not null;

        if (hasSince == hasDaysBack) // both supplied, or neither
            return (null, Results.Problem(
                title: "Exactly one of `since` or `days_back` is required.",
                detail: "Specify either an absolute `since` timestamp or a relative `days_back` count — not both, not neither.",
                statusCode: StatusCodes.Status422UnprocessableEntity));

        if (hasDaysBack && (body.DaysBack < 1 || body.DaysBack > options.RecoverMaxDaysBack))
            return (null, RecoverBoundProblem(options));

        if (hasSince && body.Since!.Value < DateTimeOffset.UtcNow.AddDays(-options.RecoverMaxDaysBack))
            return (null, RecoverBoundProblem(options));

        var resolvedSince = hasSince ? body.Since!.Value : DateTimeOffset.UtcNow.AddDays(-body.DaysBack!.Value);
        return (resolvedSince, null);
    }

    private static IResult RecoverBoundProblem(ResetOptions options) =>
        Results.Problem(
            title: "`days_back`/`since` is outside the allowed recovery window.",
            detail: $"`days_back` must be between 1 and {options.RecoverMaxDaysBack} (inclusive); " +
                    $"an absolute `since` must not be more than {options.RecoverMaxDaysBack} days in the past.",
            statusCode: StatusCodes.Status422UnprocessableEntity);

    // ── POST /api/control/events ──────────────────────────────────────────────

    private static async Task<IResult> HandlePostEventAsync(
        [FromBody] ComponentEventIngest body,
        [FromHeader(Name = "X-Component-Id")] string? componentId,
        [FromHeader(Name = "X-Correlation-Id")] string? correlationId,
        IComponentEventRepository repository,
        IComponentAckNotifier ackNotifier,
        IComponentEventNotifier componentEventNotifier,
        CancellationToken ct)
    {
        // The validation filter has already guaranteed a valid X-Component-Id before this runs;
        // the parameter is nullable only so a missing header reaches the filter (→ 422, not 400).
        ArgumentException.ThrowIfNullOrEmpty(componentId);

        // Payload is stored verbatim; reject when its serialised size exceeds the limit (413).
        var (payloadJson, payloadError) = SerializeAndValidatePayload(body);
        if (payloadError is not null)
            return payloadError;

        var entity = BuildComponentEvent(componentId, correlationId, body, payloadJson);
        await repository.InsertAsync(entity, ct);

        // NOTIFY component_events with the new row id (id-only, §7 ch.4). The ComponentEventBroadcaster
        // parses the id, fetches the full row, and fans it out to live SSE subscribers.
        await componentEventNotifier.NotifyAsync(entity.Id, ct);

        // For reset-ack / recover-ack events, NOTIFY the component_acks channel using the
        // X-Correlation-Id header so the driving orchestrator (whichever is in flight) can count
        // this ack for the active cycle (§7 ch.3, D16). A missing or invalid X-Correlation-Id
        // means the ack is recorded (204) but NOT gated.
        if (body.EventType is "reset-ack" or "recover-ack" && correlationId is { Length: > 0 })
            await ackNotifier.NotifyAsync(componentId, correlationId, ct);

        return Results.NoContent();
    }

    // ── GET /api/control/events/stream (SSE) ─────────────────────────────────

    /// <summary>
    /// Streams component-reported events as Server-Sent Events (§7 ch.4, <c>watchComponentEventStream</c>).
    /// On <c>Last-Event-ID</c> present: replays <c>id &gt; lastId</c> from <c>component_events</c>
    /// (2 h window), then attaches live. Fresh connect (no header): live only.
    /// No auth, no query filters. Event name <c>component</c>. Heartbeat `: ping` every 15 s.
    /// </summary>
    private static async Task HandleComponentEventStreamAsync(
        [FromHeader(Name = "Last-Event-ID")] string? lastEventId,
        IComponentEventBroadcaster broadcaster,
        IComponentEventRepository repository,
        HttpContext httpContext,
        CancellationToken ct)
    {
        await InitializeSseResponseAsync(httpContext, ct);

        // Replay missed events when a client reconnects with Last-Event-ID.
        if (Guid.TryParse(lastEventId, out var resumeId))
        {
            var missed = await repository.GetSinceAsync(resumeId, ct);
            foreach (var record in missed)
                await WriteComponentSseEventAsync(httpContext, record, ct);
        }

        var reader = broadcaster.Subscribe();
        try
        {
            await RunSseHeartbeatLoopAsync(httpContext, reader, ct,
                record => WriteComponentSseEventAsync(httpContext, record, ct));
        }
        finally
        {
            broadcaster.Unsubscribe(reader);
        }
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
        await InitializeSseResponseAsync(httpContext, ct);

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
            await RunSseHeartbeatLoopAsync(httpContext, reader, ct,
                async ev =>
                {
                    if (component is null || ev.Component == component || ev.Component == "*")
                        await WriteSseEventAsync(httpContext, ev, ct);
                });
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

    private static async Task WriteComponentSseEventAsync(
        HttpContext httpContext,
        ComponentEventRecord record,
        CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(record, SseJsonOptions);
        var frame = $"id: {record.Id}\nevent: component\ndata: {json}\n\n";
        await httpContext.Response.WriteAsync(frame, ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    private static async Task WriteSsePingAsync(HttpContext httpContext, CancellationToken ct)
    {
        await httpContext.Response.WriteAsync(": ping\n\n", ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    private static async Task InitializeSseResponseAsync(HttpContext httpContext, CancellationToken ct)
    {
        httpContext.Response.ContentType = "text/event-stream";
        httpContext.Response.Headers.CacheControl = "no-cache";
        httpContext.Response.Headers.Connection = "keep-alive";
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";
        await httpContext.Response.Body.FlushAsync(ct);
    }

    /// <summary>
    /// Drives the SSE read loop for a broadcast <paramref name="reader"/>, sending a heartbeat
    /// ping every 15 s when no data arrives.  Exits when the client disconnects
    /// (<paramref name="ct"/> is cancelled) or the channel completes.
    /// </summary>
    private static async Task RunSseHeartbeatLoopAsync<T>(
        HttpContext httpContext,
        ChannelReader<T> reader,
        CancellationToken ct,
        Func<T, Task> writeEvent)
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

            while (reader.TryRead(out var item))
                await writeEvent(item);
        }
    }

    private static (string? json, IResult? error) SerializeAndValidatePayload(ComponentEventIngest body)
    {
        if (body.Payload is not { } payload)
            return (null, null);

        var json = payload.GetRawText();
        if (Encoding.UTF8.GetByteCount(json) > MaxPayloadBytes)
            return (null, Results.Problem(
                title: "Payload exceeds the size limit.",
                detail: $"The payload must not exceed {MaxPayloadBytes} bytes when serialised.",
                statusCode: StatusCodes.Status413RequestEntityTooLarge));

        return (json, null);
    }

    private static ComponentEvent BuildComponentEvent(
        string componentId,
        string? correlationId,
        ComponentEventIngest body,
        string? payloadJson) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            ComponentId = componentId,
            EventType = body.EventType,
            State = body.State,
            Detail = body.Detail,
            OccurredAt = body.OccurredAt,
            ReceivedAt = DateTimeOffset.UtcNow,
            Payload = payloadJson,
            // Validation filter guarantees this is either null or a non-empty string ≤ 128 chars.
            CorrelationId = correlationId,
        };

}
