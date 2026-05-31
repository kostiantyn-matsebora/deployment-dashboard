namespace Dashboard.Control.StateMachine;

/// <summary>Triggers that drive the reset state machine transitions (D12).</summary>
internal enum ResetTrigger
{
    /// <summary>Idle → Draining: operator accepted; <c>reset-initiated</c> emitted.</summary>
    Start,

    /// <summary>Draining → Resetting: all expected acks received OR AckTimeout elapsed.</summary>
    AcksIn,

    /// <summary>Resetting → Idle: data cleared, gates released; <c>reset-completed</c> emitted.</summary>
    Complete,

    /// <summary>Any non-idle state → Idle: GateMaxTtl safety abort.</summary>
    Abort,
}
