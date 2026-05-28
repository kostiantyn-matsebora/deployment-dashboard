using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Shared.Tests;

/// <summary>
/// Verifies EF Core mapping using SQLite in-memory (no Postgres required).
/// Partial index filters and array columns are Postgres-specific and not asserted here.
/// </summary>
public sealed class DashboardDbContextTests : IDisposable
{
    private readonly DashboardDbContext _ctx;

    public DashboardDbContextTests()
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

    [Fact]
    public async Task CanInsertAndRetrieveDeploymentEvent()
    {
        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = "gh-001",
            Service = "checkout-api",
            Environment = "prod",
            Status = "success",
            HappenedAt = DateTimeOffset.UtcNow,
        };

        _ctx.DeploymentEvents.Add(ev);
        await _ctx.SaveChangesAsync();

        var loaded = await _ctx.DeploymentEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Equal("checkout-api", loaded.Service);
        Assert.Equal("prod", loaded.Environment);
        Assert.Equal("success", loaded.Status);
    }

    [Fact]
    public async Task CanInsertAndRetrieveFetcherState()
    {
        var state = new FetcherState
        {
            Adapter = "github-actions",
            Cursor = "eyJyZXBvcyI6e319",
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        _ctx.FetcherStates.Add(state);
        await _ctx.SaveChangesAsync();

        var loaded = await _ctx.FetcherStates.SingleAsync(s => s.Adapter == "github-actions");
        Assert.Equal("eyJyZXBvcyI6e319", loaded.Cursor);
    }

    [Fact]
    public async Task DeploymentEvent_OptionalFieldsDefaultToNull()
    {
        var ev = new DeploymentEvent
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = "gh-002",
            Service = "svc",
            Environment = "dev",
            Status = "in-progress",
            HappenedAt = DateTimeOffset.UtcNow,
        };

        _ctx.DeploymentEvents.Add(ev);
        await _ctx.SaveChangesAsync();
        _ctx.ChangeTracker.Clear();

        var loaded = await _ctx.DeploymentEvents.SingleAsync(e => e.Id == ev.Id);
        Assert.Null(loaded.Version);
        Assert.Null(loaded.RunUrl);
        Assert.Null(loaded.RunNumber);
        Assert.Null(loaded.Actor);
        Assert.Null(loaded.Ref);
        Assert.Null(loaded.Sha);
        Assert.Null(loaded.ParentDeployments);
        Assert.Null(loaded.ProgressReporter);
    }

    [Fact]
    public void DeploymentEvent_TableName_IsDeploymentEvents()
    {
        var entityType = _ctx.Model.FindEntityType(typeof(DeploymentEvent));
        Assert.Equal("deployment_events", entityType!.GetTableName());
    }

    [Fact]
    public void FetcherState_TableName_IsFetcherState()
    {
        var entityType = _ctx.Model.FindEntityType(typeof(FetcherState));
        Assert.Equal("fetcher_state", entityType!.GetTableName());
    }
}
