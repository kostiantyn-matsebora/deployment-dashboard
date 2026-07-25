using System.Reflection;
using Dashboard.Control.Notifiers;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Tests;

/// <summary>
/// Correlation-guard coverage for the shared-row "return to idle" writes (#423) — the fix for a
/// stale/superseded orchestrator's idle/abort write clobbering whatever newer cycle currently
/// holds the fixed <c>reset_cycle</c> row (a leaked writer from a superseded cycle previously did
/// an effective <c>UPDATE reset_cycle WHERE id=1</c> with no correlation check).
///
/// Covers:
/// <list type="number">
///   <item><see cref="ResetCycleRepository.TryReleaseToIdleAsync"/> no-ops (0 rows, row
///     unchanged) when <c>expectedCorrelationId</c> does not match the row's current
///     <c>correlation_id</c> AND the row is not already idle — the exact "stale writer meets a
///     newer claim" scenario from the CI root cause.</item>
///   <item><see cref="ResetCycleRepository.TryReleaseToIdleAsync"/> clears the row to the seeded
///     idle baseline (operation back to <c>"reset"</c>, <c>recover_since</c> null, correlation
///     null, expected/acks cleared) when the correlation matches — the normal, byte-identical
///     case.</item>
///   <item>The reconciler's orphan-clear (<c>ResetReconciler.ClearCycleToIdleAsync</c>, private —
///     exercised via reflection, mirroring the existing reflection seam for
///     <c>EmitOrphanRecoveryEventAsync</c> in <see cref="RecoverOrchestratorTimeoutTests"/>) still
///     clears a genuine orphan (row's own correlation passed as expected) and, symmetrically,
///     no-ops when a fresh claim has since superseded it.</item>
/// </list>
/// </summary>
public sealed class ChoreographyReleaseGuardTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly ResetCycleRepository _cycleRepo;

    public ChoreographyReleaseGuardTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();

        _cycleRepo = new ResetCycleRepository(_db);
    }

    public void Dispose()
    {
        _db.Database.CloseConnection();
        _db.Dispose();
    }

    private async Task<Guid> SeedDrainingCycleAsync(Guid correlationId)
    {
        var cycle = new ResetCycle
        {
            Id = 1,
            State = ResetState.Draining,
            CorrelationId = correlationId,
            ExpectedComponents = ["dashboard-fetcher", "demo-driver"],
            AcksReceived = ["dashboard-fetcher"],
            StartedAt = DateTimeOffset.UtcNow.AddSeconds(-5),
            DeadlineAt = DateTimeOffset.UtcNow.AddSeconds(10),
            Operation = ControlOperation.Recover,
            RecoverSince = DateTimeOffset.UtcNow.AddDays(-1),
        };
        await _cycleRepo.SaveAsync(cycle, CancellationToken.None);
        _db.ChangeTracker.Clear();
        return correlationId;
    }

    // ── 1. Mismatched correlation no-ops (row unchanged) ──────────────────────

    [Fact]
    public async Task TryReleaseToIdleAsync_MismatchedCorrelation_NoOpsAndLeavesRowUnchanged()
    {
        var ownerCorrelationId = Guid.CreateVersion7();
        await SeedDrainingCycleAsync(ownerCorrelationId);

        // A different (stale/superseded) correlation attempts the release.
        var staleCorrelationId = Guid.CreateVersion7();
        var released = await _cycleRepo.TryReleaseToIdleAsync(staleCorrelationId, CancellationToken.None);

        Assert.False(released);

        _db.ChangeTracker.Clear();
        var row = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Draining, row.State);
        Assert.Equal(ownerCorrelationId, row.CorrelationId);
        Assert.Equal(ControlOperation.Recover, row.Operation);
        Assert.NotNull(row.RecoverSince);
        Assert.NotNull(row.ExpectedComponents);
        Assert.NotNull(row.AcksReceived);
    }

    // ── 2. Matching correlation clears to the idle baseline ───────────────────

    [Fact]
    public async Task TryReleaseToIdleAsync_MatchingCorrelation_ClearsToIdleBaseline()
    {
        var correlationId = Guid.CreateVersion7();
        await SeedDrainingCycleAsync(correlationId);

        var released = await _cycleRepo.TryReleaseToIdleAsync(correlationId, CancellationToken.None);

        Assert.True(released);

        _db.ChangeTracker.Clear();
        var row = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, row.State);
        Assert.Null(row.CorrelationId);
        Assert.Null(row.ExpectedComponents);
        Assert.Null(row.AcksReceived);
        Assert.Null(row.StartedAt);
        Assert.Null(row.DeadlineAt);
        Assert.Equal(ControlOperation.Reset, row.Operation);
        Assert.Null(row.RecoverSince);
    }

    [Fact]
    public async Task TryReleaseToIdleAsync_RowAlreadyIdle_IsIdempotent()
    {
        // Seed the baseline idle row (mirrors the migration seed).
        await _cycleRepo.SaveAsync(new ResetCycle { Id = 1, State = ResetState.Idle }, CancellationToken.None);
        _db.ChangeTracker.Clear();

        // Nothing to protect (row already idle/unclaimed) — the release still succeeds even
        // though the caller's expected correlation doesn't match the (null) row correlation, so
        // a redundant abort call (e.g. AbortCycleAsync invoked on an already-idle cycle) stays
        // idempotent rather than being misclassified as "superseded".
        var released = await _cycleRepo.TryReleaseToIdleAsync(Guid.CreateVersion7(), CancellationToken.None);

        Assert.True(released);

        _db.ChangeTracker.Clear();
        var row = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, row.State);
        Assert.Null(row.CorrelationId);
    }

    // ── 3. Reconciler orphan-clear (via reflection: private static) ──────────

    private async Task<bool> InvokeClearCycleToIdleAsync(ResetCycle cycle, Guid expectedCorrelationId)
    {
        var method = typeof(ResetReconciler).GetMethod(
            "ClearCycleToIdleAsync", BindingFlags.NonPublic | BindingFlags.Static)!;
        var task = (Task<bool>)method.Invoke(
            null, [_db, cycle, expectedCorrelationId, null, CancellationToken.None])!;
        return await task;
    }

    [Fact]
    public async Task ReconcilerClearCycleToIdle_GenuineOrphan_ClearsToIdle()
    {
        var correlationId = await SeedDrainingCycleAsync(Guid.CreateVersion7());
        var cycle = await _cycleRepo.LoadAsync(CancellationToken.None);

        // Reconciler guards on the orphaned cycle's OWN (already-loaded) correlation_id.
        var released = await InvokeClearCycleToIdleAsync(cycle, correlationId);

        Assert.True(released);

        _db.ChangeTracker.Clear();
        var row = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Idle, row.State);
        Assert.Null(row.CorrelationId);
        Assert.Equal(ControlOperation.Reset, row.Operation);
        Assert.Null(row.RecoverSince);
    }

    [Fact]
    public async Task ReconcilerClearCycleToIdle_SupersededBetweenLoadAndClear_NoOps()
    {
        // Reconciler loaded an orphan under `staleCorrelationId`, but by the time it writes, a
        // fresh instance has already claimed the row under a new correlation — the exact race
        // the guard exists to close.
        var staleCorrelationId = Guid.CreateVersion7();
        var staleCycle = new ResetCycle { Id = 1, State = ResetState.Draining, CorrelationId = staleCorrelationId };

        var freshCorrelationId = Guid.CreateVersion7();
        await SeedDrainingCycleAsync(freshCorrelationId);

        var released = await InvokeClearCycleToIdleAsync(staleCycle, staleCorrelationId);

        Assert.False(released);

        _db.ChangeTracker.Clear();
        var row = await _cycleRepo.LoadAsync(CancellationToken.None);
        Assert.Equal(ResetState.Draining, row.State);
        Assert.Equal(freshCorrelationId, row.CorrelationId);
    }
}
