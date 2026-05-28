using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Shared.Data;

public sealed class DashboardDbContext(DbContextOptions<DashboardDbContext> options) : DbContext(options)
{
    public DbSet<DeploymentEvent> DeploymentEvents => Set<DeploymentEvent>();
    public DbSet<FetcherState> FetcherStates => Set<FetcherState>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureDeploymentEvents(modelBuilder);
        ConfigureFetcherState(modelBuilder);
    }

    private static void ConfigureDeploymentEvents(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<DeploymentEvent>(entity =>
        {
            entity.ToTable("deployment_events");

            // PK — UUIDv7, assigned by the application (Guid.CreateVersion7()).
            // Doubles as the SSE resume cursor (D2, D3).
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id)
                  .HasColumnName("id")
                  .HasColumnType("uuid")
                  .ValueGeneratedNever();

            entity.Property(e => e.DeploymentId)
                  .HasColumnName("deployment_id")
                  .IsRequired();

            entity.Property(e => e.Service)
                  .HasColumnName("service")
                  .IsRequired();

            entity.Property(e => e.Environment)
                  .HasColumnName("environment")
                  .IsRequired();

            entity.Property(e => e.Version)
                  .HasColumnName("version")
                  .HasMaxLength(50);

            entity.Property(e => e.Status)
                  .HasColumnName("status")
                  .IsRequired();

            // happened_at is emitter-supplied — NOT the server write time.
            entity.Property(e => e.HappenedAt)
                  .HasColumnName("happened_at")
                  .HasColumnType("timestamptz")
                  .IsRequired();

            entity.Property(e => e.RunUrl)
                  .HasColumnName("run_url")
                  .HasMaxLength(2048);

            entity.Property(e => e.RunNumber)
                  .HasColumnName("run_number");

            entity.Property(e => e.Actor)
                  .HasColumnName("actor")
                  .HasMaxLength(128);

            entity.Property(e => e.Ref)
                  .HasColumnName("ref")
                  .HasMaxLength(256);

            entity.Property(e => e.Sha)
                  .HasColumnName("sha")
                  .HasMaxLength(128);

            entity.Property(e => e.ParentDeployments)
                  .HasColumnName("parent_deployments")
                  .HasColumnType("text[]");

            entity.Property(e => e.ProgressReporter)
                  .HasColumnName("progress_reporter");

            // Index: Matrix current + history drawer + listing tiebreak.
            entity.HasIndex(e => new { e.Service, e.Environment, e.HappenedAt, e.Id })
                  .IsDescending(false, false, true, true)
                  .HasDatabaseName("ix_de_service_env_happened_id");

            // Partial index: Matrix last_successful.
            entity.HasIndex(e => new { e.Service, e.Environment, e.HappenedAt })
                  .IsDescending(false, false, true)
                  .HasFilter("status = 'success'")
                  .HasDatabaseName("ix_de_service_env_happened_success");

            // Index: global listing + cursor pagination.
            entity.HasIndex(e => new { e.HappenedAt, e.Id })
                  .IsDescending(true, true)
                  .HasDatabaseName("ix_de_happened_id");
        });
    }

    private static void ConfigureFetcherState(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<FetcherState>(entity =>
        {
            entity.ToTable("fetcher_state");

            entity.HasKey(e => e.Adapter);
            entity.Property(e => e.Adapter)
                  .HasColumnName("adapter")
                  .IsRequired();

            entity.Property(e => e.Cursor)
                  .HasColumnName("cursor")
                  .IsRequired();

            entity.Property(e => e.UpdatedAt)
                  .HasColumnName("updated_at")
                  .HasColumnType("timestamptz")
                  .IsRequired();
        });
    }
}
