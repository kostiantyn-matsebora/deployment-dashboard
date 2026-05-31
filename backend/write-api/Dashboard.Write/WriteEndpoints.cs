using Dashboard.Shared.Contracts;
using Dashboard.Shared.Entities;
using Dashboard.Write.Filters;
using Dashboard.Write.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Write;

public static class WriteEndpoints
{
    public static IEndpointRouteBuilder MapWriteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/deployments", HandleIngestAsync)
           .AddEndpointFilter<ApiKeyEndpointFilter>()
           .AddEndpointFilter<IngestGateEndpointFilter>()
           .AddEndpointFilter<ValidationEndpointFilter>()
           .WithName("IngestDeployment")
           .WithTags("Deployments")
           .WithSummary("Ingest a deployment event")
           .Produces<DeploymentEvent>(StatusCodes.Status201Created)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .ProducesProblem(StatusCodes.Status422UnprocessableEntity)
           .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

        return app;
    }

    private static async Task<IResult> HandleIngestAsync(
        [FromBody] DeploymentEventIngest body,
        [FromHeader(Name = "X-Progress-Reporter")] string? progressReporter,
        IDeploymentIngestService ingestService,
        CancellationToken ct)
    {
        var ev = await ingestService.IngestAsync(body, progressReporter, ct);
        return Results.Created($"/api/deployments/{ev.Id}", ev);
    }
}
