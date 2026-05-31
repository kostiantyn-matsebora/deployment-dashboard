using Dashboard.Control.Options;

namespace Dashboard.Control.Services;

/// <summary>
/// Drives the reset choreography from <c>draining → resetting → idle</c> on a background thread.
/// Abstracted so unit tests can substitute a no-op implementation.
/// </summary>
internal interface IResetOrchestrator
{
    Task DriveAsync(Guid resetId, ResetOptions options, CancellationToken appStopping);
}
