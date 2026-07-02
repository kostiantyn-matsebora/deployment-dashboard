using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Write.Services;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="DeploymentIngestService"/>.
/// Uses SQLite in-memory for the DbContext; a <see cref="CapturingNotifier"/> stubs the notifier.
/// </summary>
public sealed class DeploymentIngestServiceTests : IDisposable
{
    private readonly DashboardDbContext _ctx;
    private readonly CapturingNotifier _notifier = new();
    private readonly DeploymentIngestService _service;

    public DeploymentIngestServiceTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;
        _ctx = new DashboardDbContext(options);
        _ctx.Database.OpenConnection();
        _ctx.Database.EnsureCreated();
        _service = new DeploymentIngestService(_ctx, _notifier);
    }

    public void Dispose()
    {
        _ctx.Database.CloseConnection();
        _ctx.Dispose();
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    [Fact]
    public async Task IngestAsync_PersistsOneRowToDatabase()
    {
        await _service.IngestAsync(MinimalBody(), progressReporter: null, CancellationToken.None);
        Assert.Equal(1, await _ctx.DeploymentEvents.CountAsync());
    }

    [Fact]
    public async Task IngestAsync_StoredIdMatchesReturnedId()
    {
        var ev = (await _service.IngestAsync(MinimalBody(), null, CancellationToken.None)).Event;
        var stored = await _ctx.DeploymentEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Equal(ev.Id, stored.Id);
    }

    // ── Returned entity ───────────────────────────────────────────────────────

    [Fact]
    public async Task IngestAsync_ReturnedEventHasNonEmptyId()
    {
        var ev = (await _service.IngestAsync(MinimalBody(), null, CancellationToken.None)).Event;
        Assert.NotEqual(Guid.Empty, ev.Id);
    }

    [Fact]
    public async Task IngestAsync_MapsAllRequiredFields()
    {
        var body = MinimalBody();
        var ev = (await _service.IngestAsync(body, progressReporter: null, CancellationToken.None)).Event;

        Assert.Equal(body.DeploymentId, ev.DeploymentId);
        Assert.Equal(body.Service, ev.Service);
        Assert.Equal(body.Environment, ev.Environment);
        Assert.Equal(body.Status, ev.Status);
        Assert.Equal(body.HappenedAt, ev.HappenedAt);
    }

    [Fact]
    public async Task IngestAsync_MapsAllOptionalFields()
    {
        var body = FullBody();
        var ev = (await _service.IngestAsync(body, progressReporter: "reporter-x", CancellationToken.None)).Event;

        Assert.Equal(body.Version, ev.Version);
        Assert.Equal(body.RunUrl, ev.RunUrl);
        Assert.Equal(body.RunNumber, ev.RunNumber);
        Assert.Equal(body.Actor, ev.Actor);
        Assert.Equal(body.Ref, ev.Ref);
        Assert.Equal(body.Sha, ev.Sha);
        Assert.Equal(body.ParentDeployments, ev.ParentDeployments);
        Assert.Equal("reporter-x", ev.ProgressReporter);
    }

    [Fact]
    public async Task IngestAsync_NullProgressReporter_StoredAsNull()
    {
        var ev = (await _service.IngestAsync(MinimalBody(), progressReporter: null, CancellationToken.None)).Event;
        Assert.Null(ev.ProgressReporter);
    }

    // ── Notification ──────────────────────────────────────────────────────────

    [Fact]
    public async Task IngestAsync_NotifiesWithReturnedEventId()
    {
        var ev = (await _service.IngestAsync(MinimalBody(), null, CancellationToken.None)).Event;
        Assert.Equal(ev.Id, _notifier.LastNotifiedId);
    }

    [Fact]
    public async Task IngestAsync_NotifiesExactlyOnce()
    {
        await _service.IngestAsync(MinimalBody(), null, CancellationToken.None);
        Assert.Equal(1, _notifier.CallCount);
    }

    // ── Idempotency (unique-constraint dedup) ─────────────────────────────────

    [Fact]
    public async Task IngestAsync_SameBodyTwice_ExactlyOneRowInDatabase()
    {
        var body = MinimalBody();

        await _service.IngestAsync(body, null, CancellationToken.None);
        await _service.IngestAsync(body, null, CancellationToken.None);

        Assert.Equal(1, await _ctx.DeploymentEvents.CountAsync());
    }

    [Fact]
    public async Task IngestAsync_SameBodyTwice_SecondCallReturnedCreatedFalse()
    {
        var body = MinimalBody();

        await _service.IngestAsync(body, null, CancellationToken.None);
        var second = await _service.IngestAsync(body, null, CancellationToken.None);

        Assert.False(second.Created);
    }

    [Fact]
    public async Task IngestAsync_SameBodyTwice_SecondCallReturnsSameId()
    {
        var body = MinimalBody();

        var first = await _service.IngestAsync(body, null, CancellationToken.None);
        var second = await _service.IngestAsync(body, null, CancellationToken.None);

        // The second call returns the pre-existing row, not a new entity.
        Assert.Equal(first.Event.Id, second.Event.Id);
    }

    [Fact]
    public async Task IngestAsync_SameBodyTwice_NotifierInvokedExactlyOnce()
    {
        var body = MinimalBody();

        await _service.IngestAsync(body, null, CancellationToken.None);
        await _service.IngestAsync(body, null, CancellationToken.None);

        // The notifier must not fire for the duplicate — the subscriber already has the event.
        Assert.Equal(1, _notifier.CallCount);
    }

    [Fact]
    public async Task IngestAsync_SameDeploymentIdAndTime_DifferentStatus_CreatesTwoRows()
    {
        // Only the STATUS differs → two distinct natural keys → two rows.
        var happenedAt = DateTimeOffset.UtcNow;
        var bodyA = new DeploymentEventIngest
        {
            DeploymentId = "gh-dup-status",
            Service = "svc",
            Environment = "prod",
            Status = "in-progress",
            HappenedAt = happenedAt,
        };
        var bodyB = bodyA with { Status = "success" };

        var r1 = await _service.IngestAsync(bodyA, null, CancellationToken.None);
        var r2 = await _service.IngestAsync(bodyB, null, CancellationToken.None);

        Assert.True(r1.Created);
        Assert.True(r2.Created);
        Assert.NotEqual(r1.Event.Id, r2.Event.Id);
        Assert.Equal(2, await _ctx.DeploymentEvents.CountAsync());
    }

    [Fact]
    public async Task IngestAsync_SameDeploymentIdAndStatus_DifferentHappenedAt_CreatesTwoRows()
    {
        // Only HAPPENED_AT differs → two distinct natural keys → two rows.
        var base_ = new DeploymentEventIngest
        {
            DeploymentId = "gh-dup-ts",
            Service = "svc",
            Environment = "prod",
            Status = "success",
            HappenedAt = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero),
        };
        var later = base_ with { HappenedAt = base_.HappenedAt.AddMinutes(1) };

        var r1 = await _service.IngestAsync(base_, null, CancellationToken.None);
        var r2 = await _service.IngestAsync(later, null, CancellationToken.None);

        Assert.True(r1.Created);
        Assert.True(r2.Created);
        Assert.NotEqual(r1.Event.Id, r2.Event.Id);
        Assert.Equal(2, await _ctx.DeploymentEvents.CountAsync());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private sealed class CapturingNotifier : IDeploymentNotifier
    {
        public Guid LastNotifiedId { get; private set; }
        public int CallCount { get; private set; }

        public Task NotifyAsync(Guid eventId, CancellationToken ct = default)
        {
            LastNotifiedId = eventId;
            CallCount++;
            return Task.CompletedTask;
        }
    }

    private static DeploymentEventIngest MinimalBody() =>
        new()
        {
            DeploymentId = "gh-001",
            Service = "checkout-api",
            Environment = "prod",
            Status = "success",
            HappenedAt = DateTimeOffset.UtcNow,
        };

    private static DeploymentEventIngest FullBody() =>
        new()
        {
            DeploymentId = "gh-002",
            Service = "checkout-api",
            Environment = "staging",
            Status = "in-progress",
            HappenedAt = DateTimeOffset.UtcNow,
            Version = "1.2.3",
            RunUrl = "https://ci.example.com/runs/42",
            RunNumber = "42",
            Actor = "bot",
            Ref = "refs/heads/main",
            Sha = "abc123",
            ParentDeployments = ["gh-001"],
        };
}
