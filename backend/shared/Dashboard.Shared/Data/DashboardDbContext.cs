using Dashboard.Shared.Data.Configurations;
using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Shared.Data;

public sealed class DashboardDbContext(DbContextOptions<DashboardDbContext> options) : DbContext(options)
{
    public DbSet<DeploymentEvent> DeploymentEvents => Set<DeploymentEvent>();
    public DbSet<FetcherState> FetcherStates => Set<FetcherState>();
    public DbSet<ControlStreamEvent> ControlStreamEvents => Set<ControlStreamEvent>();
    public DbSet<ComponentEvent> ComponentEvents => Set<ComponentEvent>();
    public DbSet<ResetCycle> ResetCycles => Set<ResetCycle>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // SQLite (unit tests) cannot ORDER BY or compare DateTimeOffset columns stored as TEXT.
        // Serialise to Unix milliseconds (long) so date arithmetic works on all providers.
        var isSqlite = Database.ProviderName == "Microsoft.EntityFrameworkCore.Sqlite";
        modelBuilder.ApplyConfiguration(new DeploymentEventConfiguration(isSqlite));
        modelBuilder.ApplyConfiguration(new FetcherStateConfiguration(isSqlite));
        modelBuilder.ApplyConfiguration(new ControlStreamEventConfiguration(isSqlite));
        modelBuilder.ApplyConfiguration(new ResetCycleConfiguration(isSqlite));
        modelBuilder.ApplyConfiguration(new ComponentEventConfiguration(isSqlite));
    }
}
