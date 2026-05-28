using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Write.Filters;
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
           .AddEndpointFilter<ValidationEndpointFilter>()
           .WithName("IngestDeployment");

        return app;
    }

    private static async Task<IResult> HandleIngestAsync(
        [FromBody] DeploymentEventIngest body,
        [FromHeader(Name = "X-Progress-Reporter")] string? progressReporter,
        DashboardDbContext dbContext,
        IDeploymentNotifier notifier,
        CancellationToken ct)
    {
        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = body.DeploymentId,
            Service = body.Service,
            Environment = body.Environment,
            Version = body.Version,
            Status = body.Status,
            HappenedAt = body.HappenedAt,
            RunUrl = body.RunUrl,
            RunNumber = body.RunNumber,
            Actor = body.Actor,
            Ref = body.Ref,
            Sha = body.Sha,
            ParentDeployments = body.ParentDeployments,
            ProgressReporter = progressReporter,
        };

        dbContext.DeploymentEvents.Add(ev);
        await dbContext.SaveChangesAsync(ct);

        await notifier.NotifyAsync(ev.Id, ct);

        return Results.Created($"/api/deployments/{ev.Id}", ev);
    }
}
