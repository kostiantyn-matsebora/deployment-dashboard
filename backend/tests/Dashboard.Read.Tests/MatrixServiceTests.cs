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
        private readonly IReadOnlyList<DeploymentEvent> _current;
        private readonly IReadOnlyList<DeploymentEvent> _lastSuccessful;

        public StubRepository(
            IReadOnlyList<DeploymentEvent>? current = null,
            IReadOnlyList<DeploymentEvent>? lastSuccessful = null)
        {
            _current = current ?? [];
            _lastSuccessful = lastSuccessful ?? [];
        }

        public Task<IReadOnlyList<DeploymentEvent>> GetCurrentPerSlotAsync(
            string? serviceFilter, CancellationToken ct)
            => Task.FromResult(_current);

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
        var svc = new MatrixService(new StubRepository(current: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(ev.Id, slot.Current.Id);
        Assert.Null(slot.LastSuccessful);
    }

    [Fact]
    public async Task GetMatrixAsync_InProgressNoSuccessHistory_LastSuccessfulNull()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress);
        var svc = new MatrixService(new StubRepository(current: [ev]));

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
            current: [currentEv],
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
            current: [currentEv],
            lastSuccessful: [successEv]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var slot = result.Matrix.Rows.Single().Slots["prod"];
        Assert.Equal(currentEv.Id, slot.Current.Id);
        Assert.Equal(successEv.Id, slot.LastSuccessful!.Id);
    }

    // ── Ordering ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_MultipleServices_RowsSortedAlphabetically()
    {
        var evZ = MakeEvent("svc-z", "prod", DeploymentStatus.Success);
        var evA = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(current: [evZ, evA]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        var services = result.Matrix.Rows.Select(r => r.Service).ToList();
        Assert.Equal(["svc-a", "svc-z"], services);
    }

    [Fact]
    public async Task GetMatrixAsync_MultipleEnvironments_EnvironmentsSortedAlphabetically()
    {
        var evP = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var evD = MakeEvent("svc-a", "dev", DeploymentStatus.Success);
        var evQ = MakeEvent("svc-a", "qa", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(current: [evP, evD, evQ]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.Equal(["dev", "prod", "qa"], result.Matrix.Environments);
    }

    // ── ETag ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task GetMatrixAsync_ETagHasWeakFormat()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var svc = new MatrixService(new StubRepository(current: [ev]));

        var result = await svc.GetMatrixAsync(null, CancellationToken.None);

        Assert.StartsWith("W/\"", result.ETag);
        Assert.EndsWith("\"", result.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_SameData_ETagIsStable()
    {
        var ev = MakeEvent("svc-a", "prod", DeploymentStatus.Success);
        var stub = new StubRepository(current: [ev]);
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

        var r1 = await new MatrixService(new StubRepository(current: [ev1]))
            .GetMatrixAsync(null, CancellationToken.None);
        var r2 = await new MatrixService(new StubRepository(current: [ev2]))
            .GetMatrixAsync(null, CancellationToken.None);

        Assert.NotEqual(r1.ETag, r2.ETag);
    }

    [Fact]
    public async Task GetMatrixAsync_LastSuccessfulChanges_ETagDiffers()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var current = MakeEvent("svc-a", "prod", DeploymentStatus.InProgress, baseTime.AddMinutes(5));
        var oldSuccess = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime);
        var newSuccess = MakeEvent("svc-a", "prod", DeploymentStatus.Success, baseTime.AddMinutes(1));

        var r1 = await new MatrixService(new StubRepository(current: [current], lastSuccessful: [oldSuccess]))
            .GetMatrixAsync(null, CancellationToken.None);
        var r2 = await new MatrixService(new StubRepository(current: [current], lastSuccessful: [newSuccess]))
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
