using Dashboard.Control.Notifiers;
using Dashboard.Control.Repositories;

namespace Dashboard.Control.Services;

/// <summary>
/// The collaborators an orchestrator uses to announce a choreography transition — insert +
/// broadcast on the control stream, plus the per-instance ingest-gate NOTIFY (Fix C). Grouped
/// into one value object (data clump → value object) so <c>AbortCycleAsync</c>/<c>TransitionTo*Async</c>
/// in <see cref="ResetOrchestrator"/> and <see cref="RecoverOrchestrator"/> don't each carry the
/// trio as three separate parameters.
/// </summary>
internal sealed record ChoreographyNotifyContext(
    IControlStreamRepository ControlStream,
    IControlEventNotifier Notifier,
    IResetStateNotifier? StateNotifier);
