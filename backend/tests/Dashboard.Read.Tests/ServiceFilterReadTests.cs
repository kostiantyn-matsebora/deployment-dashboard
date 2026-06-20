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
}
