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
/// Uses the exclude-only SERVICE_EXCLUDE design (issue #348).
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
        // "checkout" single-segment → excludes the service across all repos/owners.
        var filter = ServiceFilter.Parse("checkout");
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        Assert.DoesNotContain("checkout", result);
        Assert.Contains("billing", result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_NamespaceFilter_HidesExcludedNamespace()
    {
        await SeedAsync(service: "gateway", @namespace: "org-a");
        await SeedAsync(service: "gateway", @namespace: "org-b");
        // Two-segment: "org-a/gateway" → excludes the gateway service only in namespace org-a.
        var filter = ServiceFilter.Parse("org-a/gateway");
        var repo = BuildRepo(filter);

        var result = await repo.GetDistinctServicesAsync(CancellationToken.None);

        // "gateway" still visible because org-b/gateway passes the filter.
        Assert.Contains("gateway", result);
    }

    [Fact]
    public async Task GetDistinctServicesAsync_AllNamespacesExcluded_ServiceHiddenCompletely()
    {
        await SeedAsync(service: "gateway", @namespace: "org-a");
        // Single-segment "gateway" excludes gateway in every namespace.
        var filter = ServiceFilter.Parse("gateway");
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
        var filter = ServiceFilter.Parse("checkout");
        var repo = BuildRepo(filter);

        var result = await repo.GetEffectivePerSlotAsync(null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
    }

    // ── GetLatestNonEffectivePerSlotAsync ─────────────────────────────────────

    [Fact]
    public async Task GetLatestNonEffectivePerSlotAsync_ExcludedService_IsHidden()
    {
        await SeedAsync(service: "checkout", status: DeploymentStatus.Pending);
        await SeedAsync(service: "billing", status: DeploymentStatus.Pending);
        var filter = ServiceFilter.Parse("checkout");
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
        var filter = ServiceFilter.Parse("checkout");
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
        var filter = ServiceFilter.Parse("checkout");
        var repo = BuildRepo(filter);

        var (items, _) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 100),
            CancellationToken.None);

        Assert.DoesNotContain(items, e => e.Service == "checkout");
        Assert.Contains(items, e => e.Service == "billing");
    }

    [Fact]
    public async Task ListAsync_MultiPatternExclude_HidesAllMatchingServices()
    {
        await SeedAsync(service: "checkout");
        await SeedAsync(service: "billing");
        await SeedAsync(service: "gateway");
        // Exclude two services by name.
        var filter = ServiceFilter.Parse("checkout,billing");
        var repo = BuildRepo(filter);

        var (items, _) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 100),
            CancellationToken.None);

        Assert.DoesNotContain(items, e => e.Service == "checkout");
        Assert.DoesNotContain(items, e => e.Service == "billing");
        Assert.Contains(items, e => e.Service == "gateway");
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

        var filter = ServiceFilter.Parse("checkout");
        var repo = BuildRepo(filter);

        var result = await repo.GetSinceAsync(anchor.Id, null, CancellationToken.None);

        Assert.DoesNotContain(result, e => e.Service == "checkout");
        Assert.Contains(result, e => e.Service == "billing");
        _ = evCheckout; // used implicitly
        _ = evBilling;
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

    // ── GetByIdAsync — filter applied in endpoint ─────────────────────────────

    [Fact]
    public async Task GetByIdAsync_ExcludedService_FilterBlocksItAtEndpoint()
    {
        // A stored event whose service is excluded must be blocked by the endpoint.
        // The repository returns the raw row; the endpoint applies Permits and returns 404.
        var ev = await SeedAsync(service: "checkout");
        var filter = ServiceFilter.Parse("checkout");
        var repo = BuildRepo(filter);

        var result = await repo.GetByIdAsync(ev.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.False(filter.Permits(result.Service, result.Namespace),
            "The filter must block the excluded service so the endpoint returns 404.");
    }

    [Fact]
    public async Task GetByIdAsync_NotExcludedService_FilterPermitsIt()
    {
        var ev = await SeedAsync(service: "billing");
        var filter = ServiceFilter.Parse("checkout"); // only checkout excluded
        var repo = BuildRepo(filter);

        var result = await repo.GetByIdAsync(ev.Id, CancellationToken.None);

        Assert.NotNull(result);
        Assert.True(filter.Permits(result.Service, result.Namespace),
            "The filter must permit non-excluded service so the endpoint returns 200.");
    }

    // ── ListAsync — bounded fetch with active filter (Remark 2) ──────────────

    [Fact]
    public async Task ListAsync_ActiveFilter_ReturnsFullPageWhenEnoughMatchingRowsExist()
    {
        // Seed limit*headroom rows alternating excluded/included.
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 16; i++)
        {
            var svc = i % 2 == 0 ? "excluded-svc" : "included-svc";
            await SeedAsync(service: svc, happenedAt: t0.AddHours(i));
        }

        var filter = ServiceFilter.Parse("excluded-svc");
        var repo = BuildRepo(filter);

        var (items, nextCursor) = await repo.ListAsync(
            new Dashboard.Read.Queries.DeploymentListQuery(null, null, null, null, null, null, null, 3),
            CancellationToken.None);

        Assert.Equal(3, items.Count);
        Assert.All(items, e => Assert.Equal("included-svc", e.Service));
        Assert.NotNull(nextCursor);
    }

    [Fact]
    public async Task ListAsync_ActiveFilter_ContinuationPageHasCorrectCursorAndNoOverlap()
    {
        var t0 = new DateTimeOffset(2026, 5, 1, 0, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 20; i++)
        {
            var svc = i % 2 == 0 ? "wanted" : "blocked";
            await SeedAsync(service: svc, happenedAt: t0.AddHours(i));
        }

        var filter = ServiceFilter.Parse("blocked");
        var repo = BuildRepo(filter);

        // Page 1.
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
