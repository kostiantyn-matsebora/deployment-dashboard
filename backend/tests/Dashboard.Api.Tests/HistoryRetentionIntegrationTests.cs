using Dashboard.Api.Tests.Helpers;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Write.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Api.Tests;

/// <summary>
/// Integration tests for <see cref="HistoryRetentionService.RunPrunePassAsync"/> against
/// a real Postgres container (via <see cref="PostgresFixture"/>).
///
/// Verifies:
/// <list type="bullet">
///   <item><c>deployment_events</c> older than the retention window are deleted; recent rows survive.</item>
///   <item><c>control_stream_events</c> and <c>component_events</c> older than 2 h are deleted; recent rows survive.</item>
///   <item><c>reset_cycle</c> and <c>fetcher_state</c> are untouched (D14).</item>
/// </list>
/// Runs against a REAL Postgres (Testcontainers), no mocks or in-memory providers.
/// </summary>
[Collection("api-postgres")]
public sealed class HistoryRetentionIntegrationTests : IAsyncLifetime
{
    private readonly PostgresFixture _fixture;
    private DashboardDbContext _db = null!;

    public HistoryRetentionIntegrationTests(PostgresFixture fixture) => _fixture = fixture;

    public async Task InitializeAsync()
    {
        await _fixture.ResetAsync();

        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseNpgsql(_fixture.ConnectionString)
            .Options;
        _db = new DashboardDbContext(opts);
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
    }

    // ── deployment_events: retention window (365 days default) ───────────────

    [Fact]
    public async Task PrunePass_DeletesDeploymentEventsOlderThanRetentionWindow_KeepsRecent()
    {
        // Arrange
        var now = DateTimeOffset.UtcNow;
        var old   = DeploymentEventAt(now.AddDays(-400)); // outside 365-day window → pruned
        var exact = DeploymentEventAt(now.AddDays(-365)); // exactly at boundary → survives (strict <)
        var recent = DeploymentEventAt(now.AddDays(-30)); // well within window → survives

        _db.DeploymentEvents.AddRange(old, exact, recent);
        await _db.SaveChangesAsync();

        var sut = BuildService(EmptyConfig());

        // Act
        await sut.RunPrunePassAsync(now, CancellationToken.None);

        // Assert
        _db.ChangeTracker.Clear();
        var remaining = await _db.DeploymentEvents.ToListAsync();
        Assert.Equal(2, remaining.Count);
        Assert.Contains(remaining, e => e.Id == exact.Id);
        Assert.Contains(remaining, e => e.Id == recent.Id);
        Assert.DoesNotContain(remaining, e => e.Id == old.Id);
    }

    // ── control_stream_events: 2-hour fixed window ───────────────────────────

    [Fact]
    public async Task PrunePass_DeletesControlStreamEventsOlderThanTwoHours_KeepsRecent()
    {
        var now = DateTimeOffset.UtcNow;
        var old    = ControlStreamEventAt(now.AddHours(-3));
        var recent = ControlStreamEventAt(now.AddMinutes(-30));

        _db.ControlStreamEvents.AddRange(old, recent);
        await _db.SaveChangesAsync();

        var sut = BuildService(EmptyConfig());
        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.ControlStreamEvents.ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recent.Id, remaining[0].Id);
    }

    // ── component_events: 2-hour fixed window ────────────────────────────────

    [Fact]
    public async Task PrunePass_DeletesComponentEventsOlderThanTwoHours_KeepsRecent()
    {
        var now = DateTimeOffset.UtcNow;
        var old    = ComponentEventAt(now.AddHours(-3));
        var recent = ComponentEventAt(now.AddMinutes(-10));

        _db.ComponentEvents.AddRange(old, recent);
        await _db.SaveChangesAsync();

        var sut = BuildService(EmptyConfig());
        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.ComponentEvents.ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recent.Id, remaining[0].Id);
    }

    // ── reset_cycle + fetcher_state: must NOT be pruned (D14) ────────────────

    [Fact]
    public async Task PrunePass_DoesNotTouchResetCycleOrFetcherState()
    {
        // After ResetAsync the reset_cycle singleton row is already present.
        // Add a fetcher_state row.
        var now = DateTimeOffset.UtcNow;
        _db.FetcherStates.Add(new FetcherState
        {
            Adapter = "gh-test",
            Cursor = "sha-abc",
            UpdatedAt = now.AddDays(-400), // even if ancient, must survive
        });

        // Add deployment events older than the cutoff so the prune actually runs.
        _db.DeploymentEvents.Add(DeploymentEventAt(now.AddDays(-400)));
        await _db.SaveChangesAsync();

        var sut = BuildService(EmptyConfig());
        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();

        // fetcher_state row untouched.
        var fetcherCount = await _db.FetcherStates.CountAsync();
        Assert.Equal(1, fetcherCount);

        // reset_cycle singleton row untouched.
        var resetCycleCount = await _db.ResetCycles.CountAsync();
        Assert.Equal(1, resetCycleCount);

        // The old deployment event was pruned (confirms prune actually ran).
        var deploymentCount = await _db.DeploymentEvents.CountAsync();
        Assert.Equal(0, deploymentCount);
    }

    // ── Mixed scenario: old + recent rows in all three pruned tables ──────────

    [Fact]
    public async Task PrunePass_MixedAges_PrunesOnlyStaleRowsInAllThreeTables()
    {
        var now = DateTimeOffset.UtcNow;

        // deployment_events: 1 old, 1 recent.
        var oldDep    = DeploymentEventAt(now.AddDays(-400));
        var recentDep = DeploymentEventAt(now.AddDays(-1));

        // control_stream_events: 1 old, 1 recent.
        var oldCtrl    = ControlStreamEventAt(now.AddHours(-3));
        var recentCtrl = ControlStreamEventAt(now.AddMinutes(-20));

        // component_events: 1 old, 1 recent.
        var oldComp    = ComponentEventAt(now.AddHours(-25));
        var recentComp = ComponentEventAt(now.AddMinutes(-5));

        _db.DeploymentEvents.AddRange(oldDep, recentDep);
        _db.ControlStreamEvents.AddRange(oldCtrl, recentCtrl);
        _db.ComponentEvents.AddRange(oldComp, recentComp);
        await _db.SaveChangesAsync();

        var sut = BuildService(EmptyConfig());
        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();

        var deps  = await _db.DeploymentEvents.ToListAsync();
        var ctrls = await _db.ControlStreamEvents.ToListAsync();
        var comps = await _db.ComponentEvents.ToListAsync();

        Assert.Single(deps);
        Assert.Equal(recentDep.Id, deps[0].Id);

        Assert.Single(ctrls);
        Assert.Equal(recentCtrl.Id, ctrls[0].Id);

        Assert.Single(comps);
        Assert.Equal(recentComp.Id, comps[0].Id);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Builds <see cref="HistoryRetentionService"/> with a real <see cref="ServiceProvider"/>
    /// that resolves <see cref="DashboardDbContext"/> from the Testcontainers Postgres instance.
    /// </summary>
    private HistoryRetentionService BuildService(IConfiguration config)
    {
        var services = new ServiceCollection();
        // Register a DbContext factory pointing at the Testcontainers connection.
        services.AddDbContext<DashboardDbContext>(o =>
            o.UseNpgsql(_fixture.ConnectionString));

        var provider = services.BuildServiceProvider();
        return new HistoryRetentionService(
            provider,
            config,
            NullLogger<HistoryRetentionService>.Instance);
    }

    private static IConfiguration EmptyConfig() =>
        new ConfigurationBuilder().Build();

    private static DeploymentEvent DeploymentEventAt(DateTimeOffset happenedAt) =>
        new()
        {
            Id           = Guid.CreateVersion7(),
            DeploymentId = $"dep-{Guid.NewGuid():N}",
            Service      = "svc",
            Environment  = "prod",
            Status       = "success",
            HappenedAt   = happenedAt,
        };

    private static ControlStreamEvent ControlStreamEventAt(DateTimeOffset occurredAt) =>
        new()
        {
            Id        = Guid.CreateVersion7(),
            Type      = "reset-initiated",
            Component = "*",
            OccurredAt = occurredAt,
        };

    private static ComponentEvent ComponentEventAt(DateTimeOffset receivedAt) =>
        new()
        {
            Id          = Guid.CreateVersion7(),
            ComponentId = "demo-driver",
            EventType   = "status",
            State       = "running",
            OccurredAt  = receivedAt,
            ReceivedAt  = receivedAt,
        };
}
