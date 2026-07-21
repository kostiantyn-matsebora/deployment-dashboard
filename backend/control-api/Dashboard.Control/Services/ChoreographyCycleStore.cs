using Dashboard.Control.Repositories;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Services;

/// <summary>
/// Cycle-row load/save/clear plumbing shared by <see cref="ResetOrchestrator"/> and
/// <see cref="RecoverOrchestrator"/>. Delegates the actual row I/O to
/// <see cref="Repositories.IResetCycleRepository"/> — collapsing what used to be three
/// independent implementations of "load/save the single <c>reset_cycle</c> row" (one hand-rolled
/// copy per orchestrator, plus the repository) down to the repository as the single source. This
/// class only adds the <c>ChangeTracker.Clear()</c> bracketing the orchestrators' long-lived
/// <see cref="Dashboard.Shared.Data.DashboardDbContext"/> needs between repeated load/save calls
/// within one driven cycle (draining may save multiple times as acks trickle in) — the same
/// bracketing both orchestrators used to perform individually.
/// </summary>
internal static class ChoreographyCycleStore
{
    public static async Task<ResetCycle> LoadAsync(ChoreographyCycleContext ctx, CancellationToken ct)
    {
        ctx.Db.ChangeTracker.Clear();
        return await ctx.CycleRepository.LoadAsync(ct);
    }

    public static async Task SaveAsync(ChoreographyCycleContext ctx, ResetCycle cycle, CancellationToken ct)
    {
        ctx.Db.ChangeTracker.Clear();
        await ctx.CycleRepository.SaveAsync(cycle, ct);
        ctx.Db.ChangeTracker.Clear();
    }

    /// <summary>
    /// Returns <paramref name="cycle"/> to the seeded baseline (idle, no correlation/acks/timers,
    /// <c>operation="reset"</c>, <c>recover_since=null</c>) — identical for both choreographies so
    /// a stale discriminator never lingers on the shared row once idle (the next claim always
    /// overwrites both explicitly anyway; see <see cref="ResetCycleRepository.TryClaimIdleAsync"/>).
    /// </summary>
    public static void ResetToIdleBaseline(ResetCycle cycle)
    {
        cycle.State = ResetState.Idle;
        cycle.CorrelationId = null;
        cycle.ExpectedComponents = null;
        cycle.AcksReceived = null;
        cycle.StartedAt = null;
        cycle.DeadlineAt = null;
        cycle.Operation = ControlOperation.Reset;
        cycle.RecoverSince = null;
    }
}
