namespace Dashboard.Control.Services;

/// <summary>
/// Accepts an async reset request and kicks off the choreography.
/// Returns immediately with the accepted reset's id and current state
/// (<c>202</c> semantics); the orchestration continues on a background thread.
/// </summary>
public interface IResetService
{
    /// <summary>
    /// Tries to initiate a reset. Returns <c>(resetId, "draining")</c> when accepted
    /// or <c>null</c> when a reset is already in flight (<c>409</c> path).
    /// </summary>
    Task<ResetAcceptance?> TryInitiateAsync(CancellationToken ct = default);
}

/// <summary>202 response body for an accepted reset.</summary>
public sealed record ResetAcceptance(Guid CorrelationId, string State, DateTimeOffset AcceptedAt);
