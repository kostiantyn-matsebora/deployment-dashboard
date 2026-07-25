using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class ResetCycleConfiguration : IEntityTypeConfiguration<ResetCycle>
{
    private readonly bool _isSqlite;

    internal ResetCycleConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<ResetCycle> entity)
    {
        entity.ToTable("reset_cycle");

        // Fixed PK = 1; enforces single-row semantics.
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id)
              .HasColumnName("id")
              .HasColumnType("smallint")
              .ValueGeneratedNever();

        entity.Property(e => e.State)
              .HasColumnName("state")
              .IsRequired();

        entity.Property(e => e.CorrelationId)
              .HasColumnName("correlation_id")
              .HasColumnType("uuid");

        entity.Property(e => e.ExpectedComponents)
              .HasColumnName("expected_components")
              .HasColumnType("text[]");

        entity.Property(e => e.AcksReceived)
              .HasColumnName("acks_received")
              .HasColumnType("text[]");

        entity.Property(e => e.StartedAt)
              .HasColumnName("started_at")
              .HasColumnType("timestamptz");

        entity.Property(e => e.DeadlineAt)
              .HasColumnName("deadline_at")
              .HasColumnType("timestamptz");

        // Discriminates reset vs recover on the shared single-flight row (D12).
        entity.Property(e => e.Operation)
              .HasColumnName("operation")
              .HasColumnType("text")
              .HasDefaultValue("reset")
              .IsRequired();

        // Resolved recovery rewind point; null for reset cycles and while idle.
        entity.Property(e => e.RecoverSince)
              .HasColumnName("recover_since")
              .HasColumnType("timestamptz");

        if (_isSqlite)
        {
            entity.Property(e => e.StartedAt).HasConversion(ValueConverters.NullableDateTimeOffsetToUnixMs);
            entity.Property(e => e.DeadlineAt).HasConversion(ValueConverters.NullableDateTimeOffsetToUnixMs);
            entity.Property(e => e.RecoverSince).HasConversion(ValueConverters.NullableDateTimeOffsetToUnixMs);
            // SQLite has no native array type; store as comma-delimited text.
            entity.Property(e => e.ExpectedComponents).HasConversion(ValueConverters.StringArrayToCsv);
            entity.Property(e => e.AcksReceived).HasConversion(ValueConverters.StringArrayToCsv);
        }
    }
}
