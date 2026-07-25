using Dashboard.Control.Options;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the recover choreography from <c>draining → resetting → idle</c> on a background
/// thread. Shares <see cref="ResetOrchestrator"/>'s single-flight row/advisory lock (D12) but
/// clears no data (non-destructive). Abstracted so unit tests can substitute a no-op implementation.
/// </summary>
internal interface IRecoverOrchestrator
{
    Task DriveAsync(Guid recoverId, ResetOptions options, CancellationToken appStopping);
}
