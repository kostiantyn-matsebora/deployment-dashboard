namespace Dashboard.Control.Services;

/// <summary>
/// The two deadlines that bound the draining-phase ack wait (D13): the per-cycle ack timeout and
/// the overall GateMaxTtl ceiling. Grouped into one value object (data clump → value object) so
/// <see cref="ChoreographyAckGate"/> takes one parameter instead of two.
/// </summary>
internal readonly record struct ChoreographyDeadlines(DateTimeOffset AckDeadline, DateTimeOffset GateMaxDeadline);
