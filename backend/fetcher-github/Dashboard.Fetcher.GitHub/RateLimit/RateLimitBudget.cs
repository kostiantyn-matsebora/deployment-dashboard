using System.Net.Http.Json;
using Dashboard.Fetcher.GitHub.Models;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.RateLimit;

/// <summary>
/// Tracks the fetcher's OWN GitHub API request count and throttles when the budget is
/// exhausted (F16 / F3).
///
/// Budget = floor(total_limit × pct / 100).
/// Own-count is incremented per GitHub API call — NOT read from <c>X-RateLimit-Used</c>
/// (which counts all consumers of the token, not only this fetcher process).
/// After a rate-limit window rolls over (<c>X-RateLimit-Reset</c> has passed) the own
/// counter is reset to zero so the next window starts fresh.
/// Shared across backfill and normal poll.
/// </summary>
public sealed class RateLimitBudget
{
    private readonly int _budget;
    private int _ownCount;
    private DateTimeOffset _resetAt = DateTimeOffset.MinValue;
    private int? _ciLimit;
    private int? _ciRemaining;
    private readonly ILogger<RateLimitBudget> _logger;

    private RateLimitBudget(int budget, ILogger<RateLimitBudget> logger)
    {
        _budget = budget;
        _logger = logger;
    }

    /// <summary>Maximum budget requests per window.</summary>
    public int Budget => _budget;

    /// <summary>
    /// Fetcher's own request count since process start (or since last reset rollover).
    /// Exposed for the <c>/readyz</c> snapshot (§6.1).
    /// </summary>
    public int Used => _ownCount;

    /// <summary>Unix-epoch reset timestamp from the last response; <see cref="DateTimeOffset.MinValue"/> if never received.</summary>
    public DateTimeOffset ResetAt => _resetAt;

    /// <summary>
    /// CI/CD API total hourly quota from <c>X-RateLimit-Limit</c>;
    /// <c>null</c> before the first GitHub response (F18 / §5.11).
    /// </summary>
    public int? CiLimit => _ciLimit;

    /// <summary>
    /// CI/CD-wide remaining quota from <c>X-RateLimit-Remaining</c> (all consumers);
    /// <c>null</c> before the first GitHub response (F18 / §5.11).
    /// </summary>
    public int? CiRemaining => _ciRemaining;

    /// <summary>
    /// Initialises the budget: reads GITHUB__RATE_LIMIT when set,
    /// otherwise calls GET /rate_limit; falls back to 5 000 on failure (F16).
    /// </summary>
    public static async Task<RateLimitBudget> CreateAsync(
        HttpClient github,
        int configuredLimit,
        int budgetPct,
        ILogger<RateLimitBudget> logger,
        CancellationToken ct)
    {
        var totalLimit = configuredLimit > 0
            ? configuredLimit
            : await DiscoverLimitAsync(github, logger, ct);

        var budget = (int)Math.Floor(totalLimit * (double)budgetPct / 100);
        logger.LogInformation("[RateLimit] total_limit={Total} budget_pct={Pct} budget={Budget}",
            totalLimit, budgetPct, budget);

        return new RateLimitBudget(budget, logger);
    }

    /// <summary>
    /// Called after every GitHub API response.
    /// Increments the own-request counter; resets it when the rate-limit window has rolled over.
    /// Pauses until reset_at + 1s when own count reaches the budget.
    /// Also captures <c>X-RateLimit-Limit</c> / <c>X-RateLimit-Remaining</c> for the F18 snapshot.
    /// </summary>
    public async Task RecordAndWaitIfNeededAsync(HttpResponseMessage response, CancellationToken ct)
    {
        var responseResetAt = ReadResetAt(response);

        // Roll over own-count when the window has passed.
        if (responseResetAt > _resetAt && responseResetAt <= DateTimeOffset.UtcNow)
            _ownCount = 0;

        _resetAt = responseResetAt;
        _ownCount++;

        // Capture CI/CD-wide quota fields for the per-cycle rate-limit event (F18 / §5.11).
        if (TryGetIntHeader(response, "X-RateLimit-Limit", out var ciLimit))
            _ciLimit = ciLimit;
        if (TryGetIntHeader(response, "X-RateLimit-Remaining", out var ciRemaining))
            _ciRemaining = ciRemaining;

        if (_ownCount < _budget)
            return;

        var waitUntil = _resetAt.AddSeconds(1);
        var delay = waitUntil - DateTimeOffset.UtcNow;

        _logger.LogInformation(
            "[RateLimit] budget exhausted (own_count={Count}/{Budget}); sleeping until {WaitUntil}",
            _ownCount, _budget, waitUntil);

        if (delay > TimeSpan.Zero)
            await Task.Delay(delay, ct);

        _ownCount = 0;
    }

    // ── internals ────────────────────────────────────────────────────────────

    private static async Task<int> DiscoverLimitAsync(
        HttpClient github, ILogger<RateLimitBudget> logger, CancellationToken ct)
    {
        const int defaultLimit = 5_000;
        try
        {
            var response = await github.GetAsync("/rate_limit", ct);
            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning("[RateLimit] GET /rate_limit returned {Status}; using default {Default}",
                    response.StatusCode, defaultLimit);
                return defaultLimit;
            }
            var body = await response.Content.ReadFromJsonAsync<GhRateLimitResponse>(ct);
            var limit = body?.Resources?.Core?.Limit ?? 0;
            return limit > 0 ? limit : defaultLimit;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[RateLimit] GET /rate_limit failed; using default {Default}", defaultLimit);
            return defaultLimit;
        }
    }

    private static DateTimeOffset ReadResetAt(HttpResponseMessage response)
    {
        if (TryGetHeader(response, "X-RateLimit-Reset", out var val) &&
            long.TryParse(val, out var epoch))
            return DateTimeOffset.FromUnixTimeSeconds(epoch);

        return DateTimeOffset.UtcNow.AddSeconds(60);  // safe fallback
    }

    private static bool TryGetHeader(HttpResponseMessage response, string name, out string? value)
    {
        if (response.Headers.TryGetValues(name, out var values))
        {
            value = values.FirstOrDefault();
            return value is not null;
        }
        value = null;
        return false;
    }

    private static bool TryGetIntHeader(HttpResponseMessage response, string name, out int value)
    {
        if (TryGetHeader(response, name, out var raw) && int.TryParse(raw, out value))
            return true;
        value = 0;
        return false;
    }
}
