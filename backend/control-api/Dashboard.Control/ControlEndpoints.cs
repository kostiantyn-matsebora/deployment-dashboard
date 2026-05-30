using Dashboard.Control.Filters;
using Dashboard.Control.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Dashboard.Control;

public static class ControlEndpoints
{
    public static IEndpointRouteBuilder MapControlEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/control/reset", HandleResetAsync)
           .AddEndpointFilter<ControlApiKeyEndpointFilter>()
           .WithName("Reset")
           .WithTags("Control")
           .WithSummary("Delete all deployment events and fetcher state")
           .Produces(StatusCodes.Status204NoContent)
           .ProducesProblem(StatusCodes.Status401Unauthorized)
           .Produces(StatusCodes.Status404NotFound);

        return app;
    }

    private static async Task<IResult> HandleResetAsync(
        IResetService resetService,
        CancellationToken ct)
    {
        await resetService.ResetAsync(ct);
        return Results.NoContent();
    }
}
