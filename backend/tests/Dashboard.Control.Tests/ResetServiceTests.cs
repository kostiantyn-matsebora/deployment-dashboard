using Dashboard.Control.Services;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="ResetService"/> using SQLite in-memory.
/// Verifies that both tables are cleared correctly and that the operation is idempotent.
/// </summary>
public sealed class ResetServiceTests : IDisposable
{
    private readonly DashboardDbContext _db;
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
        _service = new ResetService(_db);
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
    public async Task ResetAsync_WithBothTables_ClearsBothTables()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc-a", "staging"));
        _db.DeploymentEvents.Add(SampleEvent("svc-b", "prod"));
        _db.FetcherStates.Add(SampleFetcherState("gh"));
        await _db.SaveChangesAsync();

        await _service.ResetAsync();

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
        Assert.Equal(0, await _db.FetcherStates.CountAsync());
    }

    [Fact]
    public async Task ResetAsync_CalledTwice_Idempotent()
    {
        _db.DeploymentEvents.Add(SampleEvent("svc", "prod"));
        await _db.SaveChangesAsync();

        await _service.ResetAsync();
        await _service.ResetAsync(); // second call must not throw

        Assert.Equal(0, await _db.DeploymentEvents.CountAsync());
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
}
