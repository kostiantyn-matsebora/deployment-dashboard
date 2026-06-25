using Dashboard.Read.Queries;
using Dashboard.Read.Repositories;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Tests;

public sealed class DeploymentReadRepositoryTests : IDisposable
{
    private readonly DashboardDbContext _ctx;
    private readonly DeploymentReadRepository _repo;

    public DeploymentReadRepositoryTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;
        _ctx = new DashboardDbContext(options);
        _ctx.Database.OpenConnection();
        _ctx.Database.EnsureCreated();
        _repo = new DeploymentReadRepository(_ctx, ServiceFilter.PassAll);
    }

    public void Dispose()
    {
        _ctx.Database.CloseConnection();
        _ctx.Dispose();
    }

    // ── Seed helper ───────────────────────────────────────────────────────────

    private async Task<DeploymentEvent> SeedAsync(
        string service = "svc-a",
        string environment = "prod",
        string status = DeploymentStatus.Success,
        DateTimeOffset? happenedAt = null,
        string? deploymentId = null,
        string? @namespace = null)
    {
        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = deploymentId ?? $"dep-{Guid.NewGuid():N}",
            Service = service,
            Namespace = @namespace,
            Environment = environment,
            Status = status,
            HappenedAt = happenedAt ?? DateTimeOffset.UtcNow,
        };
        _ctx.DeploymentEvents.Add(ev);
        await _ctx.SaveChangesAsync();
        return ev;
    }

    private async Task<DeploymentEvent> SeedWithIdAsync(
        Guid id,
        string service = "svc-a",
        string environment = "prod",
        string status = DeploymentStatus.Success,
        DateTimeOffset? happenedAt = null)
    {
        var ev = new DeploymentEvent
        {
            Id = id,
            DeploymentId = $"dep-{id:N}",
            Service = service,
            Namespace = null,
            Environment = environment,
            Status = status,
            HappenedAt = happenedAt ?? DateTimeOffset.UtcNow,
        };
        _ctx.DeploymentEvents.Add(ev);
        await _ctx.SaveChangesAsync();
        return ev;
    }

    // ── GetByIdAsync ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetByIdAsync_ExistingId_ReturnsMatchingEvent()
    {
        var seeded = await SeedAsync();

        var result = await _repo.GetByIdAsync(seeded.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal(seeded.Id, result.Id);
    }

    [Fact]
    public async Task GetByIdAsync_NonExistentId_ReturnsNull()
    {
        var result = await _repo.GetByIdAsync(Guid.NewGuid(), CancellationToken.None);

        Assert.Null(result);
    }

    // ── GetDistinctServicesAsync ──────────────────────────────────────────────

    [Fact]
    public async Task GetDistinctServicesAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_WithDuplicates_ReturnsDistinctSorted()
    {
        await SeedAsync(service: "svc-z");
        await SeedAsync(service: "svc-a");
        await SeedAsync(service: "svc-a"); // duplicate

        var result = await _repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.Equal(["svc-a", "svc-z"], result);
    }

    // ── GetDistinctEnvironmentsAsync ──────────────────────────────────────────

    [Fact]
    public async Task GetDistinctEnvironmentsAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetDistinctEnvironmentsAsync(CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetDistinctEnvironmentsAsync_WithDuplicates_ReturnsDistinctSorted()
    {
        await SeedAsync(environment: "prod");
        await SeedAsync(environment: "dev");
        await SeedAsync(environment: "dev"); // duplicate

        var result = await _repo.GetDistinctEnvironmentsAsync(CancellationToken.None);

        Assert.Equal(["dev", "prod"], result);
    }

    // ── GetEffectivePerSlotAsync ──────────────────────────────────────────────

    [Fact]
    public async Task GetEffectivePerSlotAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_SingleEffectiveEvent_ReturnsThatEvent()
    {
        var seeded = await SeedAsync(status: DeploymentStatus.Success);

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(seeded.Id, result[0].Id);
    }

    [Theory]
    [InlineData(DeploymentStatus.InProgress)]
    [InlineData(DeploymentStatus.Success)]
    [InlineData(DeploymentStatus.Failure)]
    public async Task GetEffectivePerSlotAsync_EachEffectiveStatus_IsReturned(string status)
    {
        var seeded = await SeedAsync(status: status);

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(seeded.Id, result[0].Id);
    }

    [Theory]
    [InlineData(DeploymentStatus.Pending)]
    [InlineData(DeploymentStatus.Queued)]
    [InlineData(DeploymentStatus.Waiting)]
    [InlineData(DeploymentStatus.Cancelled)]
    [InlineData(DeploymentStatus.Rejected)]
    public async Task GetEffectivePerSlotAsync_NonEffectiveStatus_Excluded(string status)
    {
        await SeedAsync(status: status);

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_MultipleEffectiveInSlot_ReturnsLatestByHappenedAt()
    {
        var baseTime = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        var latest = await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime.AddHours(1));

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(latest.Id, result[0].Id);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_NonEffectiveNewerThanEffective_EffectiveStillReturned()
    {
        // Non-effective events must not displace the latest effective event.
        var baseTime = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var effectiveEv = await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.Pending, happenedAt: baseTime.AddHours(1));

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(effectiveEv.Id, result[0].Id);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_WithServiceFilter_ReturnsOnlyThatService()
    {
        await SeedAsync(service: "svc-a", status: DeploymentStatus.Success);
        await SeedAsync(service: "svc-b", status: DeploymentStatus.Success);

        var result = await _repo.GetEffectivePerSlotAsync("svc-a", CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("svc-a", result[0].Service);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_MultipleSlots_ReturnsOnePerSlot()
    {
        await SeedAsync(service: "svc-a", environment: "dev", status: DeploymentStatus.Success);
        await SeedAsync(service: "svc-a", environment: "prod", status: DeploymentStatus.InProgress);
        await SeedAsync(service: "svc-b", environment: "prod", status: DeploymentStatus.Failure);

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Equal(3, result.Count);
    }

    // ── GetLatestNonEffectivePerSlotAsync ─────────────────────────────────────

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_OnlyEffectiveEvents_ReturnsEmpty()
    {
        await SeedAsync(status: DeploymentStatus.InProgress);
        await SeedAsync(status: DeploymentStatus.Success);
        await SeedAsync(status: DeploymentStatus.Failure);

        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Theory]
    [InlineData(DeploymentStatus.Pending)]
    [InlineData(DeploymentStatus.Queued)]
    [InlineData(DeploymentStatus.Waiting)]
    [InlineData(DeploymentStatus.Cancelled)]
    [InlineData(DeploymentStatus.Rejected)]
    public async Task GetLatestNonEffectivePerSlotAsync_EachNonEffectiveStatus_IsReturned(string status)
    {
        var seeded = await SeedAsync(status: status);

        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(seeded.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_MultipleNonEffectiveInSlot_ReturnsLatest()
    {
        var baseTime = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Pending, happenedAt: baseTime);
        var latest = await SeedAsync(status: DeploymentStatus.Queued, happenedAt: baseTime.AddHours(1));

        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(latest.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_EffectiveNewerThanNonEffective_NonEffectiveStillReturned()
    {
        // Effective events must not displace the latest non-effective event.
        var baseTime = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var nonEffectiveEv = await SeedAsync(status: DeploymentStatus.Pending, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime.AddHours(1));

        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(nonEffectiveEv.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_WithServiceFilter_ReturnsOnlyThatService()
    {
        await SeedAsync(service: "svc-a", status: DeploymentStatus.Pending);
        await SeedAsync(service: "svc-b", status: DeploymentStatus.Pending);

        var result = await _repo.GetLatestNonEffectivePerSlotAsync("svc-a", CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("svc-a", result[0].Service);
    }

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_MultipleSlots_ReturnsOnePerSlot()
    {
        await SeedAsync(service: "svc-a", environment: "dev", status: DeploymentStatus.Pending);
        await SeedAsync(service: "svc-a", environment: "prod", status: DeploymentStatus.Queued);
        await SeedAsync(service: "svc-b", environment: "prod", status: DeploymentStatus.Cancelled);

        var result = await _repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Equal(3, result.Count);
    }

    // ── GetLastSuccessfulPerSlotAsync ─────────────────────────────────────────

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_OnlyNonSuccessEvents_ReturnsEmpty()
    {
        await SeedAsync(status: DeploymentStatus.InProgress);
        await SeedAsync(status: DeploymentStatus.Failure);

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_SuccessEvent_ReturnsThatEvent()
    {
        var seeded = await SeedAsync(status: DeploymentStatus.Success);

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(seeded.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_MultipleSuccessEvents_ReturnsLatest()
    {
        var baseTime = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        var latest = await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime.AddHours(1));

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(latest.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_WithServiceFilter_ReturnsOnlyThatService()
    {
        await SeedAsync(service: "svc-a", status: DeploymentStatus.Success);
        await SeedAsync(service: "svc-b", status: DeploymentStatus.Success);

        var result = await _repo.GetLastSuccessfulPerSlotAsync("svc-a", CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("svc-a", result[0].Service);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_MultipleSlots_ReturnsOnePerSlot()
    {
        // Delegates to LatestPerSlotByStatusAsync — verify the per-slot dedup path
        // returns exactly one winner per (service, environment) slot.
        await SeedAsync(service: "svc-a", environment: "dev", status: DeploymentStatus.Success);
        await SeedAsync(service: "svc-a", environment: "prod", status: DeploymentStatus.Success);
        await SeedAsync(service: "svc-b", environment: "prod", status: DeploymentStatus.Success);

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Equal(3, result.Count);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_SameHappenedAtInSlot_LatestIdWins()
    {
        // LatestPerSlot in-memory tiebreak: when two events share the same happenedAt,
        // the one with the greater id must win.
        // Use explicit, deterministic UUIDv7-shaped ids so the winner is unambiguous
        // and the test never flakes on sub-millisecond Guid.CreateVersion7() ordering.
        var sameTime = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero);

        // "Smaller" id — earlier version-7 timestamp prefix.
        var smallerId = Guid.Parse("01960000-0000-7000-8000-000000000001");
        // "Greater" id — later version-7 timestamp prefix; must win the tiebreak.
        var greaterId = Guid.Parse("01960000-0001-7000-8000-000000000001");

        await SeedWithIdAsync(smallerId, status: DeploymentStatus.Success, happenedAt: sameTime);
        var winner = await SeedWithIdAsync(greaterId, status: DeploymentStatus.Success, happenedAt: sameTime);

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(winner.Id, result[0].Id);
    }

    // ── GetLatestTerminalBeforeCurrentPerSlotAsync ────────────────────────────

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_NoEvents_ReturnsEmpty()
    {
        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_OnlyInProgress_ReturnsEmpty()
    {
        // No terminal event precedes the in-progress — result must be empty.
        await SeedAsync(status: DeploymentStatus.InProgress);

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_SuccessIsCurrentNotInProgress_ReturnsEmpty()
    {
        // Current is success (S1) — prev_failed is not applicable; result must be empty.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_FailureIsCurrentNotInProgress_ReturnsEmpty()
    {
        // Current is failure (S4) — prev_failed is not applicable; result must be empty.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Empty(result);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_PrevIsSuccess_ReturnsThatSuccess()
    {
        // S2: in-progress after a success — returns the success terminal.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var successEv = await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(successEv.Id, result[0].Id);
        Assert.Equal(DeploymentStatus.Success, result[0].Status);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_PrevIsFailure_ReturnsThatFailure()
    {
        // S6: in-progress after a failure — returns the failure terminal.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        var failureEv = await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime);
        await SeedAsync(status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(failureEv.Id, result[0].Id);
        Assert.Equal(DeploymentStatus.Failure, result[0].Status);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_S3_ReturnsLatestTerminalBeforeInProgress()
    {
        // S3: success → failure → in-progress. Latest terminal before in-progress = failure.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime);
        var failureEv = await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime.AddMinutes(10));
        await SeedAsync(status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(20));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(failureEv.Id, result[0].Id);
        Assert.Equal(DeploymentStatus.Failure, result[0].Status);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_S2_ReturnsLatestTerminalBeforeInProgress()
    {
        // S2: failure → success → in-progress. Latest terminal before in-progress = success.
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        await SeedAsync(status: DeploymentStatus.Failure, happenedAt: baseTime);
        var successEv = await SeedAsync(status: DeploymentStatus.Success, happenedAt: baseTime.AddMinutes(10));
        await SeedAsync(status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(20));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(successEv.Id, result[0].Id);
        Assert.Equal(DeploymentStatus.Success, result[0].Status);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_MultipleSlots_ReturnsOnePerSlot()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        // Slot 1 (svc-a/prod): success → in-progress
        var s1Ev = await SeedAsync(service: "svc-a", environment: "prod",
            status: DeploymentStatus.Success, happenedAt: baseTime);
        await SeedAsync(service: "svc-a", environment: "prod",
            status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));
        // Slot 2 (svc-a/dev): failure → in-progress
        var s2Ev = await SeedAsync(service: "svc-a", environment: "dev",
            status: DeploymentStatus.Failure, happenedAt: baseTime);
        await SeedAsync(service: "svc-a", environment: "dev",
            status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        Assert.Equal(2, result.Count);
        var ids = result.Select(e => e.Id).ToHashSet();
        Assert.Contains(s1Ev.Id, ids);
        Assert.Contains(s2Ev.Id, ids);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_WithServiceFilter_ReturnsOnlyThatService()
    {
        var baseTime = new DateTimeOffset(2026, 5, 28, 10, 0, 0, TimeSpan.Zero);
        await SeedAsync(service: "svc-a", status: DeploymentStatus.Failure, happenedAt: baseTime);
        await SeedAsync(service: "svc-a", status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));
        await SeedAsync(service: "svc-b", status: DeploymentStatus.Failure, happenedAt: baseTime);
        await SeedAsync(service: "svc-b", status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5));

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync("svc-a", CancellationToken.None);

        Assert.Single(result);
        Assert.Equal("svc-a", result[0].Service);
    }

    // ── ListAsync — basic ─────────────────────────────────────────────────────

    [Fact]
    public async Task ListAsync_NoEvents_ReturnsEmptyPageNoNextCursor()
    {
        var (items, nextCursor) = await _repo.ListAsync(DefaultQuery(), CancellationToken.None);

        Assert.Empty(items);
        Assert.Null(nextCursor);
    }

    [Fact]
    public async Task ListAsync_SingleEvent_ReturnsThatEvent()
    {
        var seeded = await SeedAsync();

        var (items, _) = await _repo.ListAsync(DefaultQuery(), CancellationToken.None);

        Assert.Single(items);
        Assert.Equal(seeded.Id, items[0].Id);
    }

    [Fact]
    public async Task ListAsync_MultipleEvents_OrderedByHappenedAtDescending()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        var ev1 = await SeedAsync(happenedAt: t0);
        var ev2 = await SeedAsync(happenedAt: t0.AddHours(2));
        var ev3 = await SeedAsync(happenedAt: t0.AddHours(1));

        var (items, _) = await _repo.ListAsync(DefaultQuery(), CancellationToken.None);

        Assert.Equal(ev2.Id, items[0].Id);
        Assert.Equal(ev3.Id, items[1].Id);
        Assert.Equal(ev1.Id, items[2].Id);
    }

    // ── ListAsync — filters ───────────────────────────────────────────────────

    [Fact]
    public async Task ListAsync_ServiceFilter_ReturnsOnlyMatchingRows()
    {
        await SeedAsync(service: "svc-a");
        await SeedAsync(service: "svc-b");

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Service = "svc-a" }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal("svc-a", items[0].Service);
    }

    [Fact]
    public async Task ListAsync_EnvironmentFilter_ReturnsOnlyMatchingRows()
    {
        await SeedAsync(environment: "dev");
        await SeedAsync(environment: "prod");

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Environment = "dev" }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal("dev", items[0].Environment);
    }

    [Fact]
    public async Task ListAsync_StatusFilter_ReturnsOnlyMatchingRows()
    {
        await SeedAsync(status: DeploymentStatus.Success);
        await SeedAsync(status: DeploymentStatus.Failure);

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Status = DeploymentStatus.Success }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal(DeploymentStatus.Success, items[0].Status);
    }

    [Fact]
    public async Task ListAsync_DeploymentIdFilter_ReturnsOnlyMatchingRows()
    {
        var ev1 = await SeedAsync(deploymentId: "dep-001");
        await SeedAsync(deploymentId: "dep-002");

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { DeploymentId = "dep-001" }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal(ev1.DeploymentId, items[0].DeploymentId);
    }

    [Fact]
    public async Task ListAsync_SinceFilter_ExcludesEventsBefore()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero);
        await SeedAsync(happenedAt: t0.AddHours(-1));
        var late = await SeedAsync(happenedAt: t0.AddHours(1));

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Since = t0 }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal(late.Id, items[0].Id);
    }

    [Fact]
    public async Task ListAsync_UntilFilter_ExcludesEventsAtOrAfterUntil()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 12, 0, 0, TimeSpan.Zero);
        var early = await SeedAsync(happenedAt: t0.AddHours(-1));
        await SeedAsync(happenedAt: t0);       // exactly at Until — excluded

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Until = t0 }, CancellationToken.None);

        Assert.Single(items);
        Assert.Equal(early.Id, items[0].Id);
    }

    // ── ListAsync — pagination ────────────────────────────────────────────────

    [Fact]
    public async Task ListAsync_LimitLessThanTotal_SetsNextCursor()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 5; i++)
            await SeedAsync(happenedAt: t0.AddHours(i));

        var (items, nextCursor) = await _repo.ListAsync(
            DefaultQuery() with { Limit = 3 }, CancellationToken.None);

        Assert.Equal(3, items.Count);
        Assert.NotNull(nextCursor);
    }

    [Fact]
    public async Task ListAsync_LimitEqualToTotal_NextCursorIsNull()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 3; i++)
            await SeedAsync(happenedAt: t0.AddHours(i));

        var (items, nextCursor) = await _repo.ListAsync(
            DefaultQuery() with { Limit = 3 }, CancellationToken.None);

        Assert.Equal(3, items.Count);
        Assert.Null(nextCursor);
    }

    [Fact]
    public async Task ListAsync_WithCursor_ReturnsContinuationWithNoOverlap()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        // Seed with strictly distinct happened_at values (one per hour) so the
        // cursor seek using happened_at alone gives exact page boundaries.
        for (var i = 0; i < 5; i++)
            await SeedAsync(happenedAt: t0.AddHours(5 - i));

        var (page1, cursor) = await _repo.ListAsync(
            DefaultQuery() with { Limit = 2 }, CancellationToken.None);
        Assert.NotNull(cursor);

        var (page2, _) = await _repo.ListAsync(
            DefaultQuery() with { Limit = 2, Cursor = cursor }, CancellationToken.None);

        var page1Ids = page1.Select(e => e.Id).ToHashSet();
        Assert.True(page2.All(e => !page1Ids.Contains(e.Id)),
            "Page 2 must not overlap with page 1.");
        Assert.Equal(2, page2.Count);
    }

    [Fact]
    public async Task ListAsync_InvalidCursor_IgnoredReturnsFromStart()
    {
        await SeedAsync();

        var (items, _) = await _repo.ListAsync(
            DefaultQuery() with { Cursor = "this-is-not-a-valid-cursor" }, CancellationToken.None);

        Assert.Single(items);
    }

    // ── Namespace disambiguation (#353) ───────────────────────────────────────

    [Fact]
    public async Task GetEffectivePerSlotAsync_SameServiceDifferentNamespace_ReturnsBothSlots()
    {
        // Two events share the same service name but live in different namespaces.
        // The re-keyed slot identity is (Namespace, Service, Environment) so both
        // must surface as independent slots — no cross-namespace deduplication.
        var nsA = await SeedAsync(service: "gateway", environment: "prod",
            status: DeploymentStatus.Success, @namespace: "org-a");
        var nsB = await SeedAsync(service: "gateway", environment: "prod",
            status: DeploymentStatus.Failure, @namespace: "org-b");

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Equal(2, result.Count);
        var ids = result.Select(e => e.Id).ToHashSet();
        Assert.Contains(nsA.Id, ids);
        Assert.Contains(nsB.Id, ids);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_NullNamespaceIsDistinctFromNamedNamespace()
    {
        // A null-namespace slot and a named-namespace slot for the same service
        // are two independent identity slots — neither should suppress the other.
        var nullNs = await SeedAsync(service: "api", environment: "dev",
            status: DeploymentStatus.Success, @namespace: null);
        var namedNs = await SeedAsync(service: "api", environment: "dev",
            status: DeploymentStatus.Failure, @namespace: "org-a");

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Equal(2, result.Count);
        var ids = result.Select(e => e.Id).ToHashSet();
        Assert.Contains(nullNs.Id, ids);
        Assert.Contains(namedNs.Id, ids);
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_MultipleEventsInNamespacedSlot_ReturnsLatestPerNamespace()
    {
        // Within a (Namespace, Service, Environment) slot the latest effective
        // event wins, just as before — namespace does not break per-slot dedup.
        var baseTime = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        await SeedAsync(service: "worker", environment: "prod",
            status: DeploymentStatus.Success, happenedAt: baseTime,
            @namespace: "org-a");
        var latest = await SeedAsync(service: "worker", environment: "prod",
            status: DeploymentStatus.Failure, happenedAt: baseTime.AddHours(1),
            @namespace: "org-a");

        var result = await _repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result);
        Assert.Equal(latest.Id, result[0].Id);
    }

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_SameServiceDifferentNamespace_ReturnsBothSuccesses()
    {
        // Last-successful resolution must respect namespace boundaries so that
        // org-a's success does not count as org-b's last successful deployment.
        var successA = await SeedAsync(service: "deploy", environment: "prod",
            status: DeploymentStatus.Success, @namespace: "ns-x");
        var successB = await SeedAsync(service: "deploy", environment: "prod",
            status: DeploymentStatus.Success, @namespace: "ns-y");

        var result = await _repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.Equal(2, result.Count);
        var ids = result.Select(e => e.Id).ToHashSet();
        Assert.Contains(successA.Id, ids);
        Assert.Contains(successB.Id, ids);
    }

    [Fact]
    public async Task GetLatestTerminalBeforeCurrentPerSlotAsync_NamespacedSlots_DoNotCrossContaminate()
    {
        // The prev_failed flag (GetLatestTerminalBeforeCurrentPerSlotAsync) must
        // be scoped to each (Namespace, Service, Environment) slot independently.
        // A failure in org-a must not affect the prev_failed state of org-b.
        var baseTime = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);

        // org-a: failure → in-progress  → prev_failed flag applies to org-a
        var failureA = await SeedAsync(service: "batch", environment: "prod",
            status: DeploymentStatus.Failure, happenedAt: baseTime, @namespace: "org-a");
        await SeedAsync(service: "batch", environment: "prod",
            status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5),
            @namespace: "org-a");

        // org-b: success → in-progress  → prev_failed does NOT apply to org-b
        await SeedAsync(service: "batch", environment: "prod",
            status: DeploymentStatus.Success, happenedAt: baseTime, @namespace: "org-b");
        await SeedAsync(service: "batch", environment: "prod",
            status: DeploymentStatus.InProgress, happenedAt: baseTime.AddMinutes(5),
            @namespace: "org-b");

        var result = await _repo.GetLatestTerminalBeforeCurrentPerSlotAsync(null, CancellationToken.None);

        // Only org-a's failure terminal should be returned; org-b's success terminal
        // is its latest terminal and is returned too — both are returned but
        // the failure is only for org-a's slot.
        Assert.Equal(2, result.Count);
        var failureEntry = result.Single(e => e.Namespace == "org-a");
        Assert.Equal(failureA.Id, failureEntry.Id);
        Assert.Equal(DeploymentStatus.Failure, failureEntry.Status);

        var successEntry = result.Single(e => e.Namespace == "org-b");
        Assert.Equal(DeploymentStatus.Success, successEntry.Status);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static DeploymentListQuery DefaultQuery() =>
        new(Service: null, Environment: null, Status: null, DeploymentId: null,
            Since: null, Until: null, Cursor: null, Limit: 100);
}
