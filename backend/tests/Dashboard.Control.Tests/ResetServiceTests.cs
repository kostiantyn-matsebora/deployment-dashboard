using Dashboard.Control.Notifiers;
using Dashboard.Control.Repositories;
using Dashboard.Control.Services;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="ResetService"/> using SQLite in-memory.
/// Verifies that all four tables are cleared, that a reset event is persisted + announced,
/// and that the operation is idempotent.
/// </summary>
public sealed class ResetServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;
    private readonly RecordingControlEventNotifier _notifier = new();
    private readonly ResetService _service;

    public ResetServiceTests()
    {
        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite("DataSource=:memory:")
            .Options;

        _db = new DashboardDbContext(options);
        // Keep the connection open: SQLite in-memory databases are scoped to a
        // single connection — closing it drops the schema.
        _db.Database.OpenConnection();
        _db.Database.EnsureCreated();
        _service = new ResetService(_db, new ControlStreamRepository(_db), _notifier);
    }

    public void Dispose()
    {
        _db.Database.CloseConnection();
        _db.Dispose();
    }

    [Fact]
    public async Task ResetAsync_EmptyStore_Succeeds()
    {
        // No rows exist; operation must not throw.
        await _service.ResetAsync();
    }

    [Fact]
    public async Task ResetAsync_WithDeploymentEvents_ClearsDeploymentEvents()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc", "prod"));
        await _db.SaveChangesAsync();

        await _service.ResetAsync();

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
    }

    [Fact]
    public async Task ResetAsync_WithFetcherState_ClearsFetcherState()
    {
        _db.FetcherStates.Add(SampleFetcherState("gh"));
        await _db.SaveChangesAsync();

        await _service.ResetAsync();

        Assert.Equal(0, await _db.FetcherStates.CountAsync());
    }

    [Fact]
    public async Task ResetAsync_WithAllTables_ClearsAllTables()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc-a", "staging"));
        _db.DeploymentEvents.Add(SampleEvent("svc-b", "prod"));
        _db.FetcherStates.Add(SampleFetcherState("gh"));
        _db.ComponentEvents.Add(SampleComponentEvent("demo-driver"));
        _db.ControlStreamEvents.Add(SampleControlStreamEvent());
        await _db.SaveChangesAsync();

        await _service.ResetAsync();

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
        Assert.Equal(0, await _db.FetcherStates.CountAsync());
        Assert.Equal(0, await _db.ComponentEvents.CountAsync());
        // control_stream_events holds exactly the one reset row inserted by the reset itself.
        Assert.Equal(1, await _db.ControlStreamEvents.CountAsync());
    }

    [Fact]
    public async Task ResetAsync_PersistsAndAnnouncesResetEvent()
    {
        await _service.ResetAsync();

        var persisted = Assert.Single(await _db.ControlStreamEvents.ToListAsync());
        Assert.Equal("reset", persisted.Type);
        Assert.Equal("*", persisted.Component);

        var announced = Assert.Single(_notifier.Notified);
        Assert.Equal(persisted.Id, announced.Id);
        Assert.Equal("reset", announced.Type);
    }

    [Fact]
    public async Task ResetAsync_CalledTwice_Idempotent()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc", "prod"));
        await _db.SaveChangesAsync();

        await _service.ResetAsync();
        await _service.ResetAsync(); // second call must not throw

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
        // Each reset clears the prior reset row and inserts its own → exactly one remains.
        Assert.Equal(1, await _db.ControlStreamEvents.CountAsync());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static DeploymentEvent SampleEvent(string service, string environment) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = $"gh-{Guid.NewGuid():N}",
            Service = service,
            Environment = environment,
            Status = "success",
            HappenedAt = DateTimeOffset.UtcNow,
        };

    private static FetcherState SampleFetcherState(string adapter) =>
        new()
        {
            Adapter = adapter,
            Cursor = "opaque-cursor",
            UpdatedAt = DateTimeOffset.UtcNow,
        };

    private static ComponentEvent SampleComponentEvent(string componentId) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            ComponentId = componentId,
            EventType = "status",
            State = "running",
            OccurredAt = DateTimeOffset.UtcNow,
            ReceivedAt = DateTimeOffset.UtcNow,
        };

    private static ControlStreamEvent SampleControlStreamEvent() =>
        new()
        {
            Id = Guid.CreateVersion7(),
            Type = "reset",
            Component = "*",
            OccurredAt = DateTimeOffset.UtcNow,
        };

    /// <summary>Captures announced events so the test can assert the reset was published.</summary>
    private sealed class RecordingControlEventNotifier : IControlEventNotifier
    {
        public List<ControlStreamEvent> Notified { get; } = [];

        public Task NotifyAsync(ControlStreamEvent ev, CancellationToken ct = default)
        {
            Notified.Add(ev);
            return Task.CompletedTask;
        }
    }
}
