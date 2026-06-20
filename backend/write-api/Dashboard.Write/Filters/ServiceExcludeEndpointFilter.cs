using Dashboard.Shared.Contracts;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.AspNetCore.Http;

namespace Dashboard.Write.Filters;

/// <summary>
/// Returns <c>403 Forbidden</c> with <c>application/problem+json</c> when the ingest
/// event's <c>(namespace, service)</c> matches the server-side <c>SERVICE_EXCLUDE</c>
/// configuration (issue #348).
///
/// Matching uses the pattern's last two <c>repo/service</c> segments against
/// <c>(namespace, service)</c> — the leading <c>owner</c> segment is wildcarded
/// because the API does not store owner (api-guidelines.md §5).
///
/// An empty <c>SERVICE_EXCLUDE</c> ⇒ <see cref="ServiceFilter.IsEmpty"/> is true ⇒
/// this filter is a no-op and adds zero overhead on the hot ingest path.
/// </summary>
internal sealed class ServiceExcludeEndpointFilter(ServiceFilter serviceFilter) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (!serviceFilter.IsEmpty)
        {
            var body = context.Arguments.OfType<DeploymentEventIngest>().FirstOrDefault();
            if (body is not null && serviceFilter.IsExcluded(body.Service, body.Namespace))
            {
                return Results.Problem(
                    title: "Service excluded by server configuration.",
                    detail: $"The service '{body.Namespace}/{body.Service}' matches a SERVICE_EXCLUDE pattern and will not be ingested.",
                    statusCode: StatusCodes.Status403Forbidden);
            }
        }

        return await next(context);
    }
}
