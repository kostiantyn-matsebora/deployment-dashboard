using Dashboard.Read.Models;
using Dashboard.Read.Queries;
using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Dashboard.Shared.Entities;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Read;

public static class ReadEndpoints
{
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
}
