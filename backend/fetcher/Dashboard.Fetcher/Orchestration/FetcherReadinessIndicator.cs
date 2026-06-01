namespace Dashboard.Fetcher.Orchestration;

/// <summary>
/// Thread-safe implementation of <see cref="IFetcherReadinessIndicator"/>.
/// Written by <see cref="PollLoop"/> after every cycle;
/// read by <c>GET /readyz</c> in the fetcher host.
/// </summary>
public sealed class FetcherReadinessIndicator : IFetcherReadinessIndicator
{
    // All fields guarded by _lock so a single lock covers the atomic snapshot update.
    private readonly object _lock = new();
    private PollOutcome? _lastOutcome;
    private DateTimeOffset? _lastSuccessAt;
    private string? _lastErrorSummary;
    private bool _isPausedForReset;
    private RateLimitSnapshot? _rateLimit;

    /// <inheritdoc/>
    public PollOutcome? LastOutcome { get { lock (_lock) return _lastOutcome; } }

    /// <inheritdoc/>
    public DateTimeOffset? LastSuccessAt { get { lock (_lock) return _lastSuccessAt; } }

    /// <inheritdoc/>
    public string? LastErrorSummary { get { lock (_lock) return _lastErrorSummary; } }

    /// <inheritdoc/>
    public bool IsPausedForReset { get { lock (_lock) return _isPausedForReset; } }

    /// <inheritdoc/>
    public RateLimitSnapshot? RateLimit { get { lock (_lock) return _rateLimit; } }

    /// <summary>Records a successful poll cycle.</summary>
    /// <param name="rateLimit">Optional rate-limit snapshot from the last GitHub response.</param>
    public void RecordSuccess(RateLimitSnapshot? rateLimit = null)
    {
        lock (_lock)
        {
            _lastOutcome = PollOutcome.Ok;
            _lastSuccessAt = DateTimeOffset.UtcNow;
            _lastErrorSummary = null;
            if (rateLimit is not null)
                _rateLimit = rateLimit;
        }
    }

    /// <summary>Records an authentication failure (HTTP 401 / 403).</summary>
    /// <param name="summary">Short error message for diagnostics.</param>
    public void RecordAuthFailed(string summary)
    {
        lock (_lock)
        {
            _lastOutcome = PollOutcome.AuthFailed;
            _lastErrorSummary = summary;
        }
    }

    /// <summary>Records that the rate-limit budget was exhausted.</summary>
    /// <param name="rateLimit">Current rate-limit snapshot.</param>
    public void RecordRateLimited(RateLimitSnapshot rateLimit)
    {
        lock (_lock)
        {
            _lastOutcome = PollOutcome.RateLimited;
            _lastErrorSummary = $"Rate-limit budget exhausted; resets at {rateLimit.ResetAt:u}";
            _rateLimit = rateLimit;
        }
    }

    /// <summary>Records a general error (network, 5xx, parse failure, etc.).</summary>
    /// <param name="summary">Short error message for diagnostics.</param>
    public void RecordError(string summary)
    {
        lock (_lock)
        {
            _lastOutcome = PollOutcome.Error;
            _lastErrorSummary = summary;
        }
    }

    /// <summary>Marks the loop as paused for an expected reset (healthy transient state).</summary>
    public void SetPausedForReset(bool paused)
    {
        lock (_lock)
        {
            _isPausedForReset = paused;
        }
    }
}
