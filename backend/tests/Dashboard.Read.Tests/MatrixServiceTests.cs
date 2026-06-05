using Dashboard.Read.Models;
using Dashboard.Read.Queries;
using Dashboard.Read.Repositories;
using Dashboard.Read.Services;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Entities;

namespace Dashboard.Read.Tests;

public sealed class MatrixServiceTests
{
    // ── Stub ──────────────────────────────────────────────────────────────────

    private sealed class StubRepository : IDeploymentReadRepository
    {
        private readonly IReadOnlyList<DeploymentEvent> _effective;
        private readonly IReadOnlyList<DeploymentEvent> _nonEffective;
        private readonly IReadOnlyList<DeploymentEvent> _lastSuccessful;

        public StubRepository(
            IReadOnlyList<DeploymentEvent>? effective = null,
            IReadOnlyList<DeploymentEvent>? nonEffective = null,
            IReadOnlyList<DeploymentEvent>? lastSuccessful = null)
        {
            _effective = effective ?? [];
            _nonEffective = nonEffective ?? [];
            _lastSuccessful = lastSuccessful ?? [];
        }

        public Task<IReadOnlyList<DeploymentEvent>> GetEffectivePerSlotAsync(
            string? serviceFilter, CancellationToken ct)
            => Task.FromResult(_effective);

        public Task<IReadOnlyList<DeploymentEvent>> GetLatestNonEffectivePerSlotAsync(
            string? serviceFilter, CancellationToken ct)
            => Task.FromResult(_nonEffective);

        public Task<IReadOnlyList<DeploymentEvent>> GetLastSuccessfulPerSlotAsync(
            string? serviceFilter, CancellationToken ct)
            => Task.FromResult(_lastSuccessful);

        // Unused by MatrixService — throw to surface accidental calls.
        public Task<(IReadOnlyList<DeploymentEvent>, string?)> ListAsync(
            DeploymentListQuery query, CancellationToken ct)
            => throw new NotImplementedException();

        public Task<DeploymentEvent?> GetByIdAsync(Guid id, CancellationToken ct)
            => throw new NotImplementedException();

        public Task<IReadOnlyList<string>> GetDistinctServicesAsync(CancellationToken ct)
            => throw new NotImplementedException();

        public Task<IReadOnlyList<string>> GetDistinctEnvironmentsAsync(CancellationToken ct)
            => throw new NotImplementedException();

        public Task<IReadOnlyList<DeploymentEvent>> GetSinceAsync(
            Guid lastId, string? serviceFilter, CancellationToken ct)
            => throw new NotImplementedException();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static DeploymentEvent MakeEvent(
        string service,
        string environment,
        string status,
        DateTimeOffset? happenedAt = null) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"dep-{Guid.NewGuid():N}",
            Service = service,
            Environment = environment,
            Status = status,
            HappenedAt = happenedAt ?? DateTimeOffset.UtcNow,
        };

    // ── Structure ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_NoEvents_ReturnsEmptyRowsAndEnvironments()
    {
        var svc = new MatrixService(new StubRepository());

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.Empty(result.Matrix.Rows);
        Assert.Empty(result.Matrix.Environments);
    }

    [Fact]
    public async Task GetMatrixAsync_GeneratedAtIsApproximatelyNow()
    {
        var before = DateTimeOffset.UtcNow.AddSeconds(-1);
        var svc = new MatrixService(new StubRepository());

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.True(result.Matrix.GeneratedAt >= before);
        Assert.True(result.Matrix.GeneratedAt <= DateTimeOffset.UtcNow.AddSeconds(1));
    }

    // ── Current / LastSuccessful rules ────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_SuccessEvent_CurrentSetLastSuccessfulNull()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(effective: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(ev.Id, slot.Current.Id);
        Assert.Null(slot.LastSuccessful);
    }

    [Fact]
    public async Task GetMatrixAsync_InProgressNoSuccessHistory_LastSuccessfulNull()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress);
        var svc = new MatrixService(new StubRepository(effective: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(ev.Id, slot.Current.Id);
        Assert.Null(slot.LastSuccessful);
    }

    [Fact]
    public async Task GetMatrixAsync_InProgressWithPriorSuccess_LastSuccessfulPopulated()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var successEv = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime);
        var currentEv = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, baseTime.AddMinutes(5));

        var svc = new MatrixService(new StubRepository(
            effective: [currentEv],
            lastSuccessful: [successEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(currentEv.Id, slot.Current.Id);
        Assert.Equal(successEv.Id, slot.LastSuccessful!.Id);
    }

    [Fact]
    public async Task GetMatrixAsync_FailureWithPriorSuccess_LastSuccessfulPopulated()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var successEv = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime);
        var currentEv = MakeEvent("svc-a", "prod", DeploymentStatus.Failure, baseTime.AddMinutes(5));

        var svc = new MatrixService(new StubRepository(
            effective: [currentEv],
            lastSuccessful: [successEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(currentEv.Id, slot.Current.Id);
        Assert.Equal(successEv.Id, slot.LastSuccessful!.Id);
    }

    // ── Next rules ────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_NonEffectiveNewerThanEffective_NextPopulated()
    {
        // Scenario: in-progress at T, pending at T+5 — pending is newer so it becomes next.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var effectiveEv = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, baseTime);
        var pendingEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Pending, baseTime.AddMinutes(5));

        var svc = new MatrixService(new StubRepository(
            effective: [effectiveEv],
            nonEffective: [pendingEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(effectiveEv.Id, slot.Current.Id);
        Assert.NotNull(slot.Next);
        Assert.Equal(pendingEv.Id, slot.Next!.Id);
    }

    [Fact]
    public async Task GetMatrixAsync_EffectiveNewerThanNonEffective_NextNull()
    {
        // Scenario: pending at T, then success at T+5 — success is current, next omitted.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var pendingEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Pending, baseTime);
        var effectiveEv = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime.AddMinutes(5));

        var svc = new MatrixService(new StubRepository(
            effective: [effectiveEv],
            nonEffective: [pendingEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(effectiveEv.Id, slot.Current.Id);
        Assert.Null(slot.Next);
    }

    [Fact]
    public async Task GetMatrixAsync_NonEffectiveSameTimeAsEffective_NextNull()
    {
        // next is included only when strictly newer; equal timestamps do NOT qualify.
        var at = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var effectiveEv = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, at);
        var pendingEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Pending, at);

        var svc = new MatrixService(new StubRepository(
            effective: [effectiveEv],
            nonEffective: [pendingEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(effectiveEv.Id, slot.Current.Id);
        Assert.Null(slot.Next);
    }

    [Fact]
    public async Task GetMatrixAsync_OnlyNonEffective_FallbackCurrentIsLatestNonEffective_NextNull()
    {
        // Edge case: slot has never had an effective deployment.
        // current falls back to the non-effective event; next is omitted.
        var pendingEv = MakeEvent("svc-a", "prod", DeploymentStatus.Pending);

        var svc = new MatrixService(new StubRepository(
            effective: [],
            nonEffective: [pendingEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(pendingEv.Id, slot.Current.Id);
        Assert.Null(slot.Next);
        Assert.Null(slot.LastSuccessful);
    }

    [Fact]
    public async Task GetMatrixAsync_NoNonEffective_NextNull()
    {
        // When a slot has only effective events, next is always null.
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(effective: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(ev.Id, slot.Current.Id);
        Assert.Null(slot.Next);
    }

    [Fact]
    public async Task GetMatrixAsync_LastSuccessfulUnaffectedByNextLogic()
    {
        // last_successful remains correct regardless of the next field.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var successEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime);
        var failureEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Failure, baseTime.AddMinutes(5));
        var pendingEv   = MakeEvent("svc-a", "prod", DeploymentStatus.Pending, baseTime.AddMinutes(10));

        var svc = new MatrixService(new StubRepository(
            effective: [failureEv],
            nonEffective: [pendingEv],
            lastSuccessful: [successEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(failureEv.Id, slot.Current.Id);
        Assert.Equal(successEv.Id, slot.LastSuccessful!.Id);
        Assert.Equal(pendingEv.Id, slot.Next!.Id);
    }

    // ── Ordering ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_MultipleServices_RowsSortedAlphabetically()
    {
        var evZ = MakeEvent("svc-z", "prod", DeploymentStatus.Success);
        var evA = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(effective: [evZ, evA]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var services = result.Matrix.Rows.Select(r => r.Service).ToList();
        Assert.Equal(["svc-a", "svc-z"], services);
    }

    [Fact]
    public async Task GetMatrixAsync_MultipleEnvironments_EnvironmentsSortedAlphabetically()
    {
        var evP = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var evD = MakeEvent("svc-a", "dev",  DeploymentStatus.Success);
        var evQ = MakeEvent("svc-a", "qa",   DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(effective: [evP, evD, evQ]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.Equal(["dev", "prod", "qa"], result.Matrix.Environments);
    }

    // ── ETag ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_ETagHasWeakFormat()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(effective: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.StartsWith("W/\"", result.ETag);
        Assert.EndsWith("\"", result.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_SameData_ETagIsStable()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var stub = new StubRepository(effective: [ev]);
        var svc = new MatrixService(stub);

        var r1 = await svc.GetMatrixAsync(null, CancellationToken.None);
        var r2 = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.Equal(r1.ETag, r2.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_DifferentCurrentEvents_ETagDiffers()
    {
        var ev1 = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var ev2 = MakeEvent("svc-a", "prod", DeploymentStatus.Success);

        var r1 = await new MatrixService(new StubRepository(effective: [ev1]))
            .GetMatrixAsync(null, CancellationToken.None);
        var r2 = await new MatrixService(new StubRepository(effective: [ev2]))
            .GetMatrixAsync(null, CancellationToken.None);

        Assert.NotEqual(r1.ETag, r2.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_LastSuccessfulChanges_ETagDiffers()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var current    = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, baseTime.AddMinutes(5));
        var oldSuccess = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime);
        var newSuccess = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime.AddMinutes(1));

        var r1 = await new MatrixService(new StubRepository(effective: [current], lastSuccessful: [oldSuccess]))
            .GetMatrixAsync(null, CancellationToken.None);
        var r2 = await new MatrixService(new StubRepository(effective: [current], lastSuccessful: [newSuccess]))
            .GetMatrixAsync(null, CancellationToken.None);

        Assert.NotEqual(r1.ETag, r2.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_NextChanges_ETagDiffers()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var current  = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, baseTime);
        var next1    = MakeEvent("svc-a", "prod", DeploymentStatus.Pending, baseTime.AddMinutes(1));
        var next2    = MakeEvent("svc-a", "prod", DeploymentStatus.Queued, baseTime.AddMinutes(1));

        var r1 = await new MatrixService(new StubRepository(effective: [current], nonEffective: [next1]))
            .GetMatrixAsync(null, CancellationToken.None);
        var r2 = await new MatrixService(new StubRepository(effective: [current], nonEffective: [next2]))
            .GetMatrixAsync(null, CancellationToken.None);

        Assert.NotEqual(r1.ETag, r2.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_EmptyMatrix_ETagIsStable()
    {
        var svc = new MatrixService(new StubRepository());

        var r1 = await svc.GetMatrixAsync(null, CancellationToken.None);
        var r2 = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.Equal(r1.ETag, r2.ETag);
    }
}
