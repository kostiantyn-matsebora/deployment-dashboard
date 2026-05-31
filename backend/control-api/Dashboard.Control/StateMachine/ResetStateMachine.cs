using Dashboard.Control.Repositories;
using Dashboard.Shared.Entities;
using Stateless;

namespace Dashboard.Control.StateMachine;

/// <summary>
/// Wraps the Stateless state machine for the reset choreography (D12).
/// State is externally stored in <see cref="ResetCycle"/>; the machine is reconstructed
/// per driver activation and mutates the cycle in-memory. Callers persist via the repository.
///
/// Triggers:
/// - <see cref="ResetTrigger.Start"/>      — Idle → Draining  (on POST /api/control/reset)
/// - <see cref="ResetTrigger.AcksIn"/>     — Draining → Resetting (acks complete or timeout)
/// - <see cref="ResetTrigger.Complete"/>   — Resetting → Idle (data cleared, gates released)
/// - <see cref="ResetTrigger.Abort"/>      — Draining | Resetting → Idle (GateMaxTtl safety)
/// </summary>
internal sealed class ResetStateMachine
{
    private readonly StateMachine<string, ResetTrigger> _machine;

    public ResetStateMachine(ResetCycle cycle)
    {
        // External state accessor pattern: Stateless reads/writes the cycle's State property.
        _machine = new StateMachine<string, ResetTrigger>(
            stateAccessor: () => cycle.State,
            stateMutator: s => cycle.State = s);

        _machine.Configure(ResetState.Idle)
                .Permit(ResetTrigger.Start, ResetState.Draining);

        _machine.Configure(ResetState.Draining)
                .Ignore(ResetTrigger.Start)  // 409 is handled at the endpoint; machine sees no re-entry
                .Permit(ResetTrigger.AcksIn, ResetState.Resetting)
                .Permit(ResetTrigger.Abort, ResetState.Idle);

        _machine.Configure(ResetState.Resetting)
                .Ignore(ResetTrigger.Start)  // 409 handled at endpoint
                .Permit(ResetTrigger.Complete, ResetState.Idle)
                .Permit(ResetTrigger.Abort, ResetState.Idle);
    }

    public bool IsInState(string state) => _machine.IsInState(state);

    public void Fire(ResetTrigger trigger) => _machine.Fire(trigger);

    public bool CanFire(ResetTrigger trigger) => _machine.CanFire(trigger);
}
