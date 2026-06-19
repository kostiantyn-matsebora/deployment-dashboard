using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class DeploymentEventConfiguration : IEntityTypeConfiguration<DeploymentEvent>
{
    private readonly bool _isSqlite;

    internal DeploymentEventConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<DeploymentEvent> entity)
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

        entity.Property(e => e.Namespace)
              .HasColumnName("namespace")
              .HasMaxLength(128);

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

        // SQLite cannot compare or order DateTimeOffset as TEXT.
        // Store as Unix milliseconds so ordering and comparisons work correctly in tests.
        if (_isSqlite)
            entity.Property(e => e.HappenedAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);

        entity.Property(e => e.RunUrl)
              .HasColumnName("run_url")
              .HasMaxLength(2048);

        entity.Property(e => e.RunNumber)
              .HasColumnName("run_number")
              .HasMaxLength(128);

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
    }
}
