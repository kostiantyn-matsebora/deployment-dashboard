using System.Net.Http.Json;
using Dashboard.Fetcher.GitHub.Models;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.GitHub.RateLimit;

/// <summary>
/// Tracks GitHub API rate-limit consumption and throttles when the budget is exhausted (F16).
/// Budget = floor(total_limit × pct / 100). Shared across backfill and normal poll.
/// </summary>
public sealed class RateLimitBudget
{
    private readonly int _budget;
    private int _used;
    private readonly ILogger<RateLimitBudget> _logger;

    private RateLimitBudget(int budget, ILogger<RateLimitBudget> logger)
    {
        _budget = budget;
        _logger = logger;
    }

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
    /// Called after every GitHub API response. Reads rate-limit headers;
    /// pauses until reset_at + 1s when budget exhausted.
    /// </summary>
    public async Task RecordAndWaitIfNeededAsync(HttpResponseMessage response, CancellationToken ct)
    {
        _used = ReadUsed(response);
        if (_used < _budget)
            return;

        var resetAt = ReadResetAt(response);
        var waitUntil = resetAt.AddSeconds(1);
        var delay = waitUntil - DateTimeOffset.UtcNow;

        _logger.LogInformation(
            "[RateLimit] budget exhausted (used={Used}/{Budget}); sleeping until {WaitUntil}",
            _used, _budget, waitUntil);

        if (delay > TimeSpan.Zero)
            await Task.Delay(delay, ct);

        _used = 0;
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

    private static int ReadUsed(HttpResponseMessage response)
    {
        if (TryGetHeader(response, "X-RateLimit-Used", out var usedVal) &&
            int.TryParse(usedVal, out var used))
            return used;

        if (TryGetHeader(response, "X-RateLimit-Limit", out var limitVal) &&
            TryGetHeader(response, "X-RateLimit-Remaining", out var remainingVal) &&
            int.TryParse(limitVal, out var limit) &&
            int.TryParse(remainingVal, out var remaining))
            return limit - remaining;

        return 0;
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
}
