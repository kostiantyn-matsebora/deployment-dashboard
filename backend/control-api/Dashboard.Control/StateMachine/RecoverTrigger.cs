namespace Dashboard.Control.StateMachine;

/// <summary>Triggers that drive the recover state machine transitions (D12, non-destructive).</summary>
internal enum RecoverTrigger
{
    /// <summary>Idle → Draining: operator accepted; <c>recover-initiated</c> emitted.</summary>
    Start,

    /// <summary>Draining → Resetting: all expected acks received OR AckTimeout elapsed.</summary>
    AcksIn,

    /// <summary>Resetting → Idle: cursors rewound, gates released; <c>recover-completed</c> emitted.</summary>
    Complete,

    /// <summary>Any non-idle state → Idle: GateMaxTtl safety abort.</summary>
    Abort,
}
