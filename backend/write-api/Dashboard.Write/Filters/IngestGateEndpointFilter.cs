using Dashboard.Shared.Abstractions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.Write.Filters;

/// <summary>
/// Returns <c>503 Service Unavailable</c> with <c>Retry-After</c> while the reset state machine
/// is in the <c>resetting</c> phase (ingest gate ON, §5, NFR-05).
///
/// Reads the per-instance cached flag from <see cref="IResetStateProvider"/> (updated via
/// <c>LISTEN reset_state</c> NOTIFY) — no DB round-trip on the hot ingest path (Fix C).
///
/// Eventual-consistency note: between a state-transition NOTIFY and this instance receiving it
/// there is a sub-millisecond window where a racing ingest might slip through. This is an
/// inherent TOCTOU that the previous per-request DB-SELECT version also had; the truncation
/// itself is atomic at the database level so no data is lost in that window.
///
/// <c>Retry-After</c> is derived from <c>Reset:GateMaxTtlSeconds</c> configuration
/// (the upper bound on how long the gate can remain open before the reconciler forcibly aborts it).
/// </summary>
internal sealed class IngestGateEndpointFilter : IEndpointFilter
{
    private const int DefaultRetryAfterSeconds = 60;
    private const string GateMaxTtlConfigKey = "Reset:GateMaxTtlSeconds";

    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var provider = context.HttpContext.RequestServices.GetService<IResetStateProvider>();

        if (provider?.IsResetting == true)
        {
            var config = context.HttpContext.RequestServices.GetRequiredService<IConfiguration>();
            var retryAfter = config.GetValue<int?>(GateMaxTtlConfigKey) ?? DefaultRetryAfterSeconds;

            var response = context.HttpContext.Response;
            response.Headers["Retry-After"] = retryAfter.ToString();
            return Results.Problem(
                title: "Service temporarily unavailable.",
                detail: "A system-state reset is in progress. Retry after the indicated delay.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return await next(context);
    }
}
