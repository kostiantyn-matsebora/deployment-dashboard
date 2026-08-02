using Dashboard.Control.Repositories;
using Dashboard.Shared.Entities;
using Stateless;

namespace Dashboard.Control.StateMachine;

/// <summary>
/// Wraps the Stateless state machine for the recover choreography (D12, non-destructive).
/// State is externally stored in <see cref="ResetCycle"/> — the same row/column reset uses
/// (<c>reset_cycle.state</c>, values <c>idle</c>|<c>draining</c>|<c>resetting</c> per the shared
/// <c>ResetState</c> OpenAPI enum) — <c>reset_cycle.operation</c> discriminates which
/// choreography is driving. Mirrors <see cref="ResetStateMachine"/> shape-for-shape; kept as a
/// separate type (rather than reused) so reset and recover can diverge independently.
///
/// Triggers:
/// - <see cref="RecoverTrigger.Start"/>      — Idle → Draining  (on POST /api/control/recover)
/// - <see cref="RecoverTrigger.AcksIn"/>     — Draining → Resetting (acks complete or timeout)
/// - <see cref="RecoverTrigger.Complete"/>   — Resetting → Idle (cursors rewound, gates released)
/// - <see cref="RecoverTrigger.Abort"/>      — Draining | Resetting → Idle (GateMaxTtl safety)
/// </summary>
internal sealed class RecoverStateMachine
{
    private readonly StateMachine<string, RecoverTrigger> _machine;

    public RecoverStateMachine(ResetCycle cycle)
    {
        // External state accessor pattern: Stateless reads/writes the cycle's State property.
        _machine = new StateMachine<string, RecoverTrigger>(
            stateAccessor: () => cycle.State,
            stateMutator: s => cycle.State = s);

        _machine.Configure(ResetState.Idle)
                .Permit(RecoverTrigger.Start, ResetState.Draining);

        _machine.Configure(ResetState.Draining)
                .Ignore(RecoverTrigger.Start)  // 409 is handled at the endpoint; machine sees no re-entry
                .Permit(RecoverTrigger.AcksIn, ResetState.Resetting)
                .Permit(RecoverTrigger.Abort, ResetState.Idle);

        _machine.Configure(ResetState.Resetting)
                .Ignore(RecoverTrigger.Start)  // 409 handled at endpoint
                .Permit(RecoverTrigger.Complete, ResetState.Idle)
                .Permit(RecoverTrigger.Abort, ResetState.Idle);
    }

    public bool IsInState(string state) => _machine.IsInState(state);

    public void Fire(RecoverTrigger trigger) => _machine.Fire(trigger);

    public bool CanFire(RecoverTrigger trigger) => _machine.CanFire(trigger);
}
