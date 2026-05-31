using Dashboard.Shared.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Write.Filters;

/// <summary>
/// Returns <c>503 Service Unavailable</c> with <c>Retry-After</c> while the reset state machine
/// is in the <c>resetting</c> phase (ingest gate ON, §5, NFR-05).
/// Reads the current phase directly from the DB so the gate works across all stateless replicas.
/// </summary>
internal sealed class IngestGateEndpointFilter : IEndpointFilter
{
    private const string ResettingState = "resetting";
    private const int RetryAfterSeconds = 5;

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<DashboardDbContext>();

        // Single-row query; PK = 1. Returns null if no reset has ever run (idle implicitly).
        var cycleState = await db.ResetCycles
            .Where(r => r.Id == 1)
            .Select(r => r.State)
            .FirstOrDefaultAsync(context.HttpContext.RequestAborted);

        if (cycleState == ResettingState)
        {
            var response = context.HttpContext.Response;
            response.Headers["Retry-After"] = RetryAfterSeconds.ToString();
            return Results.Problem(
                title: "Service temporarily unavailable.",
                detail: "A system-state reset is in progress. Retry after the indicated delay.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return await next(context);
    }
}
