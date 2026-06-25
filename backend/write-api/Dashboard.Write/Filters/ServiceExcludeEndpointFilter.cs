using Dashboard.Shared.Contracts;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.AspNetCore.Http;

namespace Dashboard.Write.Filters;

/// <summary>
/// Returns <c>403 Forbidden</c> with <c>application/problem+json</c> when the ingest
/// event's <c>(namespace, service)</c> matches a <c>SERVICE_EXCLUDE</c> pattern
/// (issue #348).
///
/// A slashless pattern is matched against <c>service</c> only (all namespaces).
/// A pattern containing <c>'/'</c> is glob-matched against the composite
/// <c>namespace/service</c> identity, where <c>'*'</c> spans <c>'/'</c>
/// (the namespace itself may contain <c>'/'</c>).
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
