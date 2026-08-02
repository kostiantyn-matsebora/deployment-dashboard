namespace Dashboard.Control.Services;

/// <summary>
/// Accepts an async, non-destructive recovery request and kicks off the choreography.
/// Shares the reset choreography's single-flight row + advisory lock (D12) — a recovery cannot
/// start while a reset (or another recovery) is draining or resetting, and vice versa.
/// Returns immediately with the accepted recovery's id, state, and resolved <c>since</c>
/// (<c>202</c> semantics); the orchestration continues on a background thread.
/// </summary>
public interface IRecoverService
{
    /// <summary>
    /// Tries to initiate a recovery that rewinds fetcher cursors to <paramref name="since"/>
    /// (already resolved from <c>since</c> / <c>days_back</c> by the endpoint). Returns the
    /// acceptance when accepted, or <c>null</c> when a reset or recover is already in flight
    /// (<c>409</c> path).
    /// </summary>
    Task<RecoverAcceptance?> TryInitiateAsync(DateTimeOffset since, CancellationToken ct = default);
}

/// <summary>202 response body for an accepted recovery.</summary>
public sealed record RecoverAcceptance(Guid CorrelationId, string State, DateTimeOffset Since, DateTimeOffset AcceptedAt);
