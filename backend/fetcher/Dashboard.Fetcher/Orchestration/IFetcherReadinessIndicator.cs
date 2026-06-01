namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Functional readiness of the fetcher's poll cycle.
/// Updated by <see cref="PollLoop"/> after every successful or failed cycle.
/// Consumed by <c>GET /readyz</c> in the fetcher host.
/// </summary>
public interface IFetcherReadinessIndicator
{
    // ── Read surface (consumed by GET /readyz) ──────────────────────────────

    /// <summary>Outcome of the most recent poll cycle, or <c>null</c> before the first cycle completes.</summary>
    PollOutcome? LastOutcome { get; }

    /// <summary>UTC timestamp of the last successful poll; <c>null</c> before the first success.</summary>
    DateTimeOffset? LastSuccessAt { get; }

    /// <summary>Summary of the last error, or <c>null</c> when the last cycle succeeded.</summary>
    string? LastErrorSummary { get; }

    /// <summary>Whether the poll loop is currently paused for an expected reset (healthy transient).</summary>
    bool IsPausedForReset { get; }

    /// <summary>Optional rate-limit snapshot from the most recent GitHub response.</summary>
    RateLimitSnapshot? RateLimit { get; }

    // ── Write surface (called by PollLoop) ──────────────────────────────────

    /// <summary>Records a successful poll cycle.</summary>
    /// <param name="rateLimit">Optional rate-limit snapshot from the last GitHub response.</param>
    void RecordSuccess(RateLimitSnapshot? rateLimit = null);

    /// <summary>Records an authentication failure (HTTP 401 / 403).</summary>
    /// <param name="summary">Short error message for diagnostics.</param>
    void RecordAuthFailed(string summary);

    /// <summary>Records that the rate-limit budget was exhausted.</summary>
    /// <param name="rateLimit">Current rate-limit snapshot.</param>
    void RecordRateLimited(RateLimitSnapshot rateLimit);

    /// <summary>Records a general error (network, 5xx, parse failure, etc.).</summary>
    /// <param name="summary">Short error message for diagnostics.</param>
    void RecordError(string summary);

    /// <summary>Marks the loop as paused for an expected reset (healthy transient state).</summary>
    void SetPausedForReset(bool paused);
}

/// <summary>Outcome values for a poll cycle.</summary>
public enum PollOutcome
{
    /// <summary>Cycle completed and events were delivered (or no new events — still ok).</summary>
    Ok,
    /// <summary>GitHub returned 401 or 403 — token invalid or insufficient permissions.</summary>
    AuthFailed,
    /// <summary>GitHub rate-limit exhausted; the adapter backed off.</summary>
    RateLimited,
    /// <summary>Other error (network, 5xx, parse failure, etc.).</summary>
    Error,
}

/// <summary>Snapshot of GitHub rate-limit state at the time of the last poll response.</summary>
/// <param name="Used">Requests consumed in the current window.</param>
/// <param name="Budget">Maximum allowed requests per window for this fetcher.</param>
/// <param name="ResetAt">UTC timestamp when the window resets; <c>DateTimeOffset.MinValue</c> if not yet received.</param>
public sealed record RateLimitSnapshot(int Used, int Budget, DateTimeOffset ResetAt);
