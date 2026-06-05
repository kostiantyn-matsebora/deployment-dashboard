using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Dashboard.Write.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="HistoryRetentionService"/>.
/// Covers: cutoff date math, the ≥90 day floor clamp, and selective table pruning.
/// Uses SQLite in-memory for the DbContext; no hosted-service lifecycle exercised.
/// </summary>
public sealed class HistoryRetentionServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;

    public HistoryRetentionServiceTests()
    {
        var opts = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;
        _db = new DashboardDbContext(opts);
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Database.CloseConnection();
        _db.Dispose();
    }

    // ── ResolveRetentionDays ──────────────────────────────────────────────────

    [Fact]
    public void ResolveRetentionDays_WhenAbsent_ReturnsDefault()
    {
        var config = EmptyConfig();
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(HistoryRetentionService.DefaultRetentionDays, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenUnparseable_ReturnsDefault()
    {
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "not-a-number");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(HistoryRetentionService.DefaultRetentionDays, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenZero_ReturnsDefault()
    {
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "0");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(HistoryRetentionService.DefaultRetentionDays, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenNegative_ReturnsDefault()
    {
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "-10");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(HistoryRetentionService.DefaultRetentionDays, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenBelowFloor_ClampsToFloor()
    {
        // Supply 30 — below the 90-day floor; must clamp UP.
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "30");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(HistoryRetentionService.MinRetentionDays, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenExactlyAtFloor_ReturnsThatValue()
    {
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "90");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(90, days);
    }

    [Fact]
    public void ResolveRetentionDays_WhenAboveFloor_ReturnsThatValue()
    {
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "180");
        var days = HistoryRetentionService.ResolveRetentionDays(config, NullLogger.Instance);
        Assert.Equal(180, days);
    }

    // ── Cutoff math: deployment_events ───────────────────────────────────────

    [Fact]
    public async Task PrunePass_DeletesDeploymentEventsOlderThanRetentionWindow()
    {
        // "now" = a fixed reference point.
        var now = new DateTimeOffset(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);
        var retentionDays = 365;

        // cutoff = now - 365 days = 2024-06-01T12:00:00Z
        // Condition is: happened_at < cutoff (strict less-than).

        // Strictly before cutoff — must be deleted.
        var old = DeploymentEventAt(now.AddDays(-(retentionDays + 1)));
        // Exactly at the cutoff — NOT strictly less than, so it survives.
        var atCutoff = DeploymentEventAt(now.AddDays(-retentionDays));
        // Recent — must survive.
        var recent = DeploymentEventAt(now.AddDays(-1));

        _db.DeploymentEvents.AddRange(old, atCutoff, recent);
        await _db.SaveChangesAsync();

        var services = BuildServiceProvider();
        var config = ConfigWith("HISTORY_RETENTION_DAYS", retentionDays.ToString());
        var sut = new HistoryRetentionService(services, config, NullLogger<HistoryRetentionService>.Instance);

        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.DeploymentEvents.ToListAsync();
        // atCutoff and recent survive; only "old" (strictly before cutoff) is deleted.
        Assert.Equal(2, remaining.Count);
        Assert.Contains(remaining, e => e.Id == atCutoff.Id);
        Assert.Contains(remaining, e => e.Id == recent.Id);
    }

    // ── Cutoff math: short retention (2 h) ───────────────────────────────────

    [Fact]
    public async Task PrunePass_DeletesControlStreamEventsOlderThanTwoHours()
    {
        var now = new DateTimeOffset(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);

        var old = ControlStreamEventAt(now.AddHours(-3));
        var recent = ControlStreamEventAt(now.AddMinutes(-30));

        _db.ControlStreamEvents.AddRange(old, recent);
        await _db.SaveChangesAsync();

        var services = BuildServiceProvider();
        var sut = new HistoryRetentionService(services, EmptyConfig(), NullLogger<HistoryRetentionService>.Instance);

        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.ControlStreamEvents.ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recent.Id, remaining[0].Id);
    }

    [Fact]
    public async Task PrunePass_DeletesComponentEventsOlderThanTwoHours()
    {
        var now = new DateTimeOffset(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);

        var old = ComponentEventAt(now.AddHours(-3));
        var recent = ComponentEventAt(now.AddMinutes(-10));

        _db.ComponentEvents.AddRange(old, recent);
        await _db.SaveChangesAsync();

        var services = BuildServiceProvider();
        var sut = new HistoryRetentionService(services, EmptyConfig(), NullLogger<HistoryRetentionService>.Instance);

        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.ComponentEvents.ToListAsync();
        Assert.Single(remaining);
        Assert.Equal(recent.Id, remaining[0].Id);
    }

    // ── Floor clamp affects actual prune cutoff ───────────────────────────────

    [Fact]
    public async Task PrunePass_WhenSuppliedDaysBelowFloor_UsesClamped90DayCutoff()
    {
        // Supply 30 days — below the floor. After clamping to 90, the effective cutoff is
        // now - 90 days. A row 60 days old is within the 90-day window and survives.
        // A row 91 days old is strictly before the cutoff and is pruned.
        var now = new DateTimeOffset(2025, 6, 1, 12, 0, 0, TimeSpan.Zero);

        var sixtyDaysOld = DeploymentEventAt(now.AddDays(-60));  // within 90-day window → survives
        var ninetyOneDaysOld = DeploymentEventAt(now.AddDays(-91)); // outside 90-day window → pruned

        _db.DeploymentEvents.AddRange(sixtyDaysOld, ninetyOneDaysOld);
        await _db.SaveChangesAsync();

        var services = BuildServiceProvider();
        var config = ConfigWith("HISTORY_RETENTION_DAYS", "30"); // below floor → clamped to 90
        var sut = new HistoryRetentionService(services, config, NullLogger<HistoryRetentionService>.Instance);

        await sut.RunPrunePassAsync(now, CancellationToken.None);

        _db.ChangeTracker.Clear();
        var remaining = await _db.DeploymentEvents.ToListAsync();
        // 91-days-old row is strictly before the 90-day cutoff → pruned.
        // 60-days-old row is within the window → survives.
        Assert.Single(remaining);
        Assert.Equal(sixtyDaysOld.Id, remaining[0].Id);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private IServiceProvider BuildServiceProvider()
    {
        // Share the same in-memory SQLite connection by registering the pre-built context instance.
        // Registering as singleton is safe here: the in-memory db lives for the test's lifetime
        // and RunPrunePassAsync resolves DashboardDbContext from the created scope.
        var collection = new ServiceCollection();
        collection.AddSingleton(_db);
        return collection.BuildServiceProvider();
    }

    private static IConfiguration EmptyConfig() =>
        new ConfigurationBuilder().Build();

    private static IConfiguration ConfigWith(string key, string value) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { [key] = value })
            .Build();

    private static DeploymentEvent DeploymentEventAt(DateTimeOffset happenedAt) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"dep-{Guid.NewGuid():N}",
            Service = "svc",
            Environment = "prod",
            Status = "success",
            HappenedAt = happenedAt,
        };

    private static ControlStreamEvent ControlStreamEventAt(DateTimeOffset occurredAt) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = "reset-initiated",
            Component = "*",
            OccurredAt = occurredAt,
        };

    private static ComponentEvent ComponentEventAt(DateTimeOffset receivedAt) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            ComponentId = "demo-driver",
            EventType = "status",
            State = "running",
            OccurredAt = receivedAt,
            ReceivedAt = receivedAt,
        };
}
