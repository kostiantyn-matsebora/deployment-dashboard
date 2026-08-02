using Dashboard.Control.Repositories;
using Dashboard.Shared.Data;

namespace Dashboard.Control.Services;

/// <summary>
/// The <c>reset_cycle</c> row's data-access pair — the <see cref="DashboardDbContext"/> the
/// running cycle owns for its whole scope, and the repository <see cref="ChoreographyCycleStore"/>
/// delegates row I/O to. Grouped into one value object (data clump → value object) so the
/// choreography helpers (<see cref="ChoreographyAckGate"/>, orchestrator abort/transition steps)
/// don't each carry the pair as two separate parameters.
/// </summary>
internal sealed record ChoreographyCycleContext(DashboardDbContext Db, IResetCycleRepository CycleRepository);
