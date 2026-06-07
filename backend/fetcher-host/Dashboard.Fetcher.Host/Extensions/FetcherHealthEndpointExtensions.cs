using Dashboard.Fetcher.Orchestration;

namespace Dashboard.Fetcher.Host.Extensions;

/// <summary>
/// Maps the liveness and functional-readiness HTTP endpoints for the fetcher host (§3, §6.1).
/// </summary>
internal static class FetcherHealthEndpointExtensions
{
    /// <summary>
    /// Maps <c>GET /health</c>, <c>GET /healthz</c> (liveness), and <c>GET /readyz</c>
    /// (functional readiness reflecting GitHub poll-cycle health).
    /// </summary>
    internal static WebApplication MapFetcherHealthEndpoints(this WebApplication app)
    {
        // Liveness: process is alive. No adapter/ingest logic consulted (FETCHER_SPECIFICATION §3, §6).
        app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
        app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

        // Functional readiness: reflects actual GitHub poll-cycle health (FETCHER_SPECIFICATION §6).
        // Decision: 503 when last_outcome is auth_failed or error AND the loop is NOT paused for reset.
        //           200 in all other cases (ok, rate_limited, paused-for-reset, never-polled).
        // Paused-for-reset is an expected healthy transient — must NOT read as failed.
        app.MapGet("/readyz", (IFetcherReadinessIndicator indicator) =>
        {
            var outcome = indicator.LastOutcome;
            var paused = indicator.IsPausedForReset;

            var isHardFailure = !paused &&
                outcome is PollOutcome.AuthFailed or PollOutcome.Error;

            var status = outcome is PollOutcome.Ok ? "ready" : "degraded";

            var rl = indicator.RateLimit;
            object? rateLimitPayload = rl is null ? null : new
            {
                used = rl.Used,
                budget = rl.Budget,
                reset_at = rl.ResetAt == DateTimeOffset.MinValue ? (DateTimeOffset?)null : rl.ResetAt,
                ci_limit = rl.CiLimit,
                ci_remaining = rl.CiRemaining,
            };

            var body = new
            {
                status,
                github = new
                {
                    reachable = outcome is PollOutcome.Ok or PollOutcome.RateLimited,
                    last_outcome = OutcomeLabel(outcome),
                    last_success_at = indicator.LastSuccessAt,
                    last_error = indicator.LastErrorSummary,
                    paused_for_reset = paused,
                    rate_limit = rateLimitPayload,
                },
            };

            return isHardFailure
                ? Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable)
                : Results.Ok(body);
        });

        return app;
    }

    internal static string? OutcomeLabel(PollOutcome? outcome) => outcome switch
    {
        PollOutcome.Ok => "ok",
        PollOutcome.AuthFailed => "auth_failed",
        PollOutcome.RateLimited => "rate_limited",
        PollOutcome.Error => "error",
        null => null,
        _ => outcome.ToString()?.ToLowerInvariant(),
    };
}
