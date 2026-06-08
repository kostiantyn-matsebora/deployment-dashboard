using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Read.Models;
using Dashboard.Read.Queries;
using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Dashboard.Read.Sse;
using Dashboard.Shared.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Read;

public static class ReadEndpoints
{
    // Snake_case + null-omit — must match the global HttpJsonOptions set in Program.cs.
    private static readonly JsonSerializerOptions SseJsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static IEndpointRouteBuilder MapReadEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/deployments", HandleListAsync)
           .WithName("ListDeployments")
           .WithTags("Deployments")
           .WithSummary("List deployment events")
           .Produces<DeploymentEventPage>(StatusCodes.Status200OK);

        app.MapGet("/api/deployments/{id:guid}", HandleGetByIdAsync)
           .WithName("GetDeployment")
           .WithTags("Deployments")
           .WithSummary("Get a deployment event by ID")
           .Produces<DeploymentEvent>(StatusCodes.Status200OK)
           .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapGet("/api/matrix", HandleMatrixAsync)
           .WithName("GetMatrix")
           .WithTags("Matrix")
           .WithSummary("Get the deployment matrix")
           .Produces<MatrixResponse>(StatusCodes.Status200OK)
           .Produces(StatusCodes.Status304NotModified);

        app.MapGet("/api/services", HandleListServicesAsync)
           .WithName("ListServices")
           .WithTags("Discovery")
           .WithSummary("List all known services")
           .Produces<DiscoveryResponse>(StatusCodes.Status200OK);

        app.MapGet("/api/environments", HandleListEnvironmentsAsync)
           .WithName("ListEnvironments")
           .WithTags("Discovery")
           .WithSummary("List all known environments")
           .Produces<DiscoveryResponse>(StatusCodes.Status200OK);

        app.MapGet("/api/events/stream", HandleSseAsync)
           .WithName("StreamEvents")
           .WithTags("Stream")
           .WithSummary("SSE stream of newly-appended deployment events");

        return app;
    }

    private static async Task<IResult> HandleListAsync(
        [FromQuery] string? service,
        [FromQuery] string? environment,
        [FromQuery] string? status,
        [FromQuery(Name = "deployment_id")] string? deploymentId,
        [FromQuery] DateTimeOffset? since,
        [FromQuery] DateTimeOffset? until,
        [FromQuery] string? cursor,
        [FromQuery] int? limit,
        IDeploymentReadRepository repository,
        CancellationToken ct)
    {
        var query = new DeploymentListQuery(
            Service: service,
            Environment: environment,
            Status: status,
            DeploymentId: deploymentId,
            Since: since,
            Until: until,
            Cursor: cursor,
            Limit: Math.Clamp(limit ?? 100, 1, 500));

        var (items, nextCursor) = await repository.ListAsync(query, ct);
        return Results.Ok(new DeploymentEventPage(items, nextCursor));
    }

    private static async Task<IResult> HandleGetByIdAsync(
        Guid id,
        IDeploymentReadRepository repository,
        CancellationToken ct)
    {
        var ev = await repository.GetByIdAsync(id, ct);
        return ev is null
            ? Results.Problem(
                title: "Deployment event not found.",
                statusCode: StatusCodes.Status404NotFound)
            : Results.Ok(ev);
    }

    private static async Task<IResult> HandleMatrixAsync(
        [FromQuery] string? service,
        [FromHeader(Name = "If-None-Match")] string? ifNoneMatch,
        IMatrixService matrixService,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var result = await matrixService.GetMatrixAsync(service, ct);
        httpContext.Response.Headers.ETag = result.ETag;

        if (ifNoneMatch is not null && ifNoneMatch == result.ETag)
            return Results.StatusCode(StatusCodes.Status304NotModified);

        return Results.Ok(result.Matrix);
    }

    private static async Task<IResult> HandleListServicesAsync(
        IDeploymentReadRepository repository,
        CancellationToken ct)
    {
        var items = await repository.GetDistinctServicesAsync(ct);
        return Results.Ok(new DiscoveryResponse(items));
    }

    private static async Task<IResult> HandleListEnvironmentsAsync(
        IDeploymentReadRepository repository,
        CancellationToken ct)
    {
        var items = await repository.GetDistinctEnvironmentsAsync(ct);
        return Results.Ok(new DiscoveryResponse(items));
    }

    // ── SSE stream ────────────────────────────────────────────────────────────

    /// <summary>
    /// Streams deployment events as Server-Sent Events.
    /// <list type="bullet">
    ///   <item>Replays events with <c>id &gt; Last-Event-ID</c> before attaching to the live channel.</item>
    ///   <item>Emits <c>: ping</c> heartbeat comments every 15 s.</item>
    ///   <item>Filters by <c>?service=</c> when supplied.</item>
    /// </list>
    /// Response is written directly to <see cref="HttpContext.Response"/> to support
    /// SSE comment lines (<c>: ping</c>) which <c>Results.ServerSentEvents</c> cannot produce.
    /// </summary>
    private static async Task HandleSseAsync(
        [FromHeader(Name = "Last-Event-ID")] string? lastEventId,
        [FromQuery] string? service,
        IDeploymentEventBroadcaster broadcaster,
        IDeploymentReadRepository repository,
        HttpContext httpContext,
        CancellationToken ct)
    {
        httpContext.Response.ContentType = "text/event-stream";
        httpContext.Response.Headers.CacheControl = "no-cache";
        httpContext.Response.Headers.Connection = "keep-alive";
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";

        // Flush headers immediately so clients using HttpCompletionOption.ResponseHeadersRead
        // receive the 200 + Content-Type before any events arrive (or before the 15 s ping fires).
        await httpContext.Response.Body.FlushAsync(ct);

        // Replay missed events when client reconnects with Last-Event-ID.
        if (Guid.TryParse(lastEventId, out var resumeId))
        {
            var missed = await repository.GetSinceAsync(resumeId, service, ct);
            foreach (var ev in missed)
                await WriteSseEventAsync(httpContext, ev, ct);
        }

        // Subscribe to live events and stream until the client disconnects.
        var reader = broadcaster.Subscribe();
        try
        {
            while (!ct.IsCancellationRequested)
            {
                // Wait up to 15 s for the next event; emit a heartbeat on timeout.
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
                    if (service is null || ev.Service == service)
                        await WriteSseEventAsync(httpContext, ev, ct);
                }
            }
        }
        finally
        {
            broadcaster.Unsubscribe(reader);
        }
    }

    private static async Task WriteSseEventAsync(
        HttpContext httpContext,
        DeploymentEvent ev,
        CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(ev, SseJsonOptions);
        var frame = $"id: {ev.Id}\nevent: deployment\ndata: {json}\n\n";
        await httpContext.Response.WriteAsync(frame, ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    private static async Task WriteSsePingAsync(HttpContext httpContext, CancellationToken ct)
    {
        await httpContext.Response.WriteAsync(": ping\n\n", ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }
}
