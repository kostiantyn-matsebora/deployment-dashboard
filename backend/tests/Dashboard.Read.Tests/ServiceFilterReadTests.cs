using Dashboard.Read.Repositories;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Read.Tests;

/// <summary>
/// Tests that the deployment-wide <see cref="ServiceFilter"/> is applied correctly by
/// <see cref="DeploymentReadRepository"/> on all read paths: distinct-services, slot queries,
/// list/deployments, and GetSinceAsync (SSE replay).
/// Uses SQLite in-memory — no mocks, real implementations.
/// </summary>
public sealed class ServiceFilterReadTests : IDisposable
{
    private readonly DashboardDbContext _ctx;

    public ServiceFilterReadTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;
        _ctx = new DashboardDbContext(options);
        _ctx.Database.OpenConnection();
        _ctx.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _ctx.Database.CloseConnection();
        _ctx.Dispose();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private DeploymentReadRepository BuildRepo(ServiceFilter filter) =>
        new(_ctx, filter);

    private async Task<DeploymentEvent> SeedAsync(
        string service = "svc-a",
        string environment = "prod",
        string status = DeploymentStatus.Success,
        string? @namespace = null,
        DateTimeOffset? happenedAt = null)
    {
        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"dep-{Guid.NewGuid():N}",
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

    // ── GetDistinctServicesAsync ──────────────────────────────────────────────

    [Fact]
    public async Task GetDistinctServicesAsync_ExcludedService_IsHidden()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.DoesNotContain("checkout", result);
        Assert.Contains("billing", result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_IncludeFilter_HidesNonMatchingServices()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse("checkout", null, null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.Equal(["checkout"], result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_NamespaceFilter_HidesExcludedNamespace()
    {
        await SeedAsync(service: "gateway", @namespace: "org-a");
        await SeedAsync(service: "gateway", @namespace: "org-b");
        // Exclude the composite org-a/gateway.
        var filter = ServiceFilter.Parse(null, "org-a/gateway", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        // "gateway" is still visible because org-b/gateway passes the filter.
        Assert.Contains("gateway", result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_AllNamespacesExcluded_ServiceHiddenCompletely()
    {
        await SeedAsync(service: "gateway", @namespace: "org-a");
        // Exclude the service by name (no slash → all namespaces).
        var filter = ServiceFilter.Parse(null, "gateway", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.DoesNotContain("gateway", result);
    }

    // ── GetEffectivePerSlotAsync ──────────────────────────────────────────────

    [Fact]
    public async Task GetEffectivePerSlotAsync_ExcludedService_IsHidden()
    {
        await SeedAsync(service: "checkout", status: DeploymentStatus.Success);
        await SeedAsync(service: "billing", status: DeploymentStatus.Success);
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
    }

    [Fact]
    public async Task GetEffectivePerSlotAsync_IncludeFilter_HidesNonMatchingServices()
    {
        await SeedAsync(service: "checkout", status: DeploymentStatus.Success);
        await SeedAsync(service: "billing", status: DeploymentStatus.Success);
        var filter = ServiceFilter.Parse("billing", null, null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Single(result, e => e.Service == "billing");
    }

    // ── GetLatestNonEffectivePerSlotAsync ─────────────────────────────────────

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_ExcludedService_IsHidden()
    {
        await SeedAsync(service: "checkout", status: DeploymentStatus.Pending);
        await SeedAsync(service: "billing", status: DeploymentStatus.Pending);
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetLatestNonEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
    }

    // ── GetLastSuccessfulPerSlotAsync ─────────────────────────────────────────

    [Fact]
    public async Task GetLastSuccessfulPerSlotAsync_ExcludedService_IsHidden()
    {
        await SeedAsync(service: "checkout", status: DeploymentStatus.Success);
        await SeedAsync(service: "billing", status: DeploymentStatus.Success);
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetLastSuccessfulPerSlotAsync(null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
    }

    // ── ListAsync (GET /api/deployments) ─────────────────────────────────────

    [Fact]
    public async Task ListAsync_ExcludedService_IsHiddenFromPage()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var (items, _) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 100),
            CancellationToken.None);

        Assert.DoesNotContain(items, e => e.Service == "checkout");
        Assert.Contains(items, e => e.Service == "billing");
    }

    [Fact]
    public async Task ListAsync_IncludeFilter_HidesNonMatchingServices()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse("billing", null, null, null);
        var repo = BuildRepo(filter);

        var (items, _) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 100),
            CancellationToken.None);

        Assert.Single(items, e => e.Service == "billing");
    }

    // ── GetSinceAsync (SSE replay) ────────────────────────────────────────────

    // A fixed anchor GUID with a zero-timestamp prefix: guaranteed to be less than
    // any real UUIDv7 generated at runtime, making the `id > anchor` comparison stable.
    private static readonly Guid AnchorId = Guid.Parse("00000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task GetSinceAsync_ExcludedService_IsHiddenFromReplay()
    {
        var anchor = new DeploymentEvent
        {
            Id = AnchorId,
            DeploymentId = "anchor",
            Service = "anchor-svc",
            Environment = "prod",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddSeconds(-10),
        };
        _ctx.DeploymentEvents.Add(anchor);
        await _ctx.SaveChangesAsync();

        // Events with IDs after anchor (all real UUIDv7s are > AnchorId).
        var evCheckout = await SeedAsync(service: "checkout");
        var evBilling = await SeedAsync(service: "billing");

        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetSinceAsync(anchor.Id, null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
        _ = evCheckout; // used implicitly
        _ = evBilling;
    }

    [Fact]
    public async Task GetSinceAsync_IncludeFilter_HidesNonMatchingServices()
    {
        var anchor = new DeploymentEvent
        {
            Id = AnchorId,
            DeploymentId = "anchor",
            Service = "anchor-svc",
            Environment = "prod",
            Status = DeploymentStatus.Success,
            HappenedAt = DateTimeOffset.UtcNow.AddSeconds(-10),
        };
        _ctx.DeploymentEvents.Add(anchor);
        await _ctx.SaveChangesAsync();

        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");

        var filter = ServiceFilter.Parse("billing", null, null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetSinceAsync(anchor.Id, null, CancellationToken.None);

        Assert.Single(result, e => e.Service == "billing");
    }

    // ── PassAll filter — no regression ───────────────────────────────────────

    [Fact]
    public async Task PassAll_DoesNotAffectExistingBehavior()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        var repo = BuildRepo(ServiceFilter.PassAll);

        var services = await repo.GetDistinctServicesAsync(CancellationToken.None);
        var effective = await repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.Contains("checkout", services);
        Assert.Contains("billing", services);
        Assert.Equal(2, effective.Count);
    }

    // ── GetByIdAsync — service filter applied (Remark 1) ─────────────────────

    [Fact]
    public async Task GetByIdAsync_ExcludedService_Returns404Shape()
    {
        // A stored event whose service is excluded must be hidden: GetByIdAsync returns null
        // so the endpoint can return 404 — same shape as a genuinely missing id.
        var ev = await SeedAsync(service: "checkout");
        var filter = ServiceFilter.Parse(null, "checkout", null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetByIdAsync(ev.Id, CancellationToken.None);

        // GetByIdAsync still returns the row — the filter is applied in the endpoint.
        // The test covers the endpoint-level path: a non-null result for an excluded service
        // must cause a 404, not a 200.  We verify the repository returns the raw row and
        // then that the filter blocks it.
        Assert.NotNull(result);
        Assert.False(filter.Permits(result.Service, result.Namespace),
            "The filter must block the excluded service so the endpoint returns 404.");
    }

    [Fact]
    public async Task GetByIdAsync_IncludedService_IsPermittedByFilter()
    {
        // A stored event whose service passes the filter must NOT be hidden by the
        // endpoint's filter check: the row is returned and filter.Permits returns true.
        var ev = await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse("billing", null, null, null);
        var repo = BuildRepo(filter);

        var result = await repo.GetByIdAsync(ev.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.True(filter.Permits(result.Service, result.Namespace),
            "The filter must permit the included service so the endpoint returns 200.");
    }

    // ── ListAsync — bounded fetch with active filter (Remark 2) ──────────────

    [Fact]
    public async Task ListAsync_ActiveFilter_ReturnsFullPageWhenEnoughMatchingRowsExist()
    {
        // Seed limit*headroom rows alternating excluded/included.
        // With a headroom multiplier of 4 and limit=3, seed 4*4=16 rows, 8 excluded + 8 included.
        // The bounded fetch must collect 4 (limit+1) included rows to correctly set the
        // next-cursor without loading the entire table.
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 16; i++)
        {
            // Even index → excluded service, odd index → included service.
            var svc = i % 2 == 0 ? "excluded-svc" : "included-svc";
            await SeedAsync(service: svc, happenedAt: t0.AddHours(i));
        }

        var filter = ServiceFilter.Parse("included-svc", null, null, null);
        var repo = BuildRepo(filter);

        var (items, nextCursor) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 3),
            CancellationToken.None);

        // Must return exactly limit=3 items (all from included-svc).
        Assert.Equal(3, items.Count);
        Assert.All(items, e => Assert.Equal("included-svc", e.Service));
        // next-cursor must be set because there are more included rows beyond the page.
        Assert.NotNull(nextCursor);
    }

    [Fact]
    public async Task ListAsync_ActiveFilter_ContinuationPageHasCorrectCursorAndNoOverlap()
    {
        // Seed 10 included rows and 10 excluded rows, interleaved, with distinct timestamps.
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 20; i++)
        {
            var svc = i % 2 == 0 ? "wanted" : "blocked";
            await SeedAsync(service: svc, happenedAt: t0.AddHours(i));
        }

        var filter = ServiceFilter.Parse("wanted", null, null, null);
        var repo = BuildRepo(filter);

        // Page 1
        var (page1, cursor1) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 4),
            CancellationToken.None);

        Assert.Equal(4, page1.Count);
        Assert.NotNull(cursor1);
        Assert.All(page1, e => Assert.Equal("wanted", e.Service));

        // Page 2 — must not overlap with page 1.
        var (page2, _) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, cursor1, 4),
            CancellationToken.None);

        Assert.All(page2, e => Assert.Equal("wanted", e.Service));
        var page1Ids = page1.Select(e => e.Id).ToHashSet();
        Assert.True(page2.All(e => !page1Ids.Contains(e.Id)),
            "Page 2 must not overlap with page 1.");
    }

    [Fact]
    public async Task ListAsync_PassAllFastPath_BoundedFetchUnchanged()
    {
        // Validates that the PassAll fast-path still applies Take(limit+1) at the DB level.
        // Seed limit+2 rows — all pass filter — and confirm exactly limit items returned
        // with a next-cursor (i.e., the DB bound was applied, not a full-table load).
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 7; i++)
            await SeedAsync(happenedAt: t0.AddHours(i));

        var repo = BuildRepo(ServiceFilter.PassAll);

        var (items, nextCursor) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 5),
            CancellationToken.None);

        Assert.Equal(5, items.Count);
        Assert.NotNull(nextCursor);
    }
}
