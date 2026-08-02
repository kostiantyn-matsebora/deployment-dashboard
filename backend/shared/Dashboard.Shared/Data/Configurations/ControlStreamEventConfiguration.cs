using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class ControlStreamEventConfiguration : IEntityTypeConfiguration<ControlStreamEvent>
{
    private readonly bool _isSqlite;

    internal ControlStreamEventConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<ControlStreamEvent> entity)
    {
        entity.ToTable("control_stream_events");

        // PK — UUIDv7, application-assigned. Doubles as the SSE resume cursor (D2, D3).
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id)
              .HasColumnName("id")
              .HasColumnType("uuid")
              .ValueGeneratedNever();

        entity.Property(e => e.Type)
              .HasColumnName("type")
              .IsRequired();

        entity.Property(e => e.Component)
              .HasColumnName("component")
              .IsRequired();

        // Nullable: present on all three frames; on reset-initiated it equals the event id.
        // On reset-started / reset-completed it equals the reset-initiated id.
        entity.Property(e => e.CorrelationId)
              .HasColumnName("correlation_id")
              .HasColumnType("uuid");

        entity.Property(e => e.OccurredAt)
              .HasColumnName("occurred_at")
              .HasColumnType("timestamptz")
              .IsRequired();

        // Opaque blob, stored verbatim. jsonb on Postgres; plain text on SQLite (no jsonb type) —
        // mirrors ComponentEventConfiguration.Payload.
        entity.Property(e => e.Payload)
              .HasColumnName("payload")
              .HasColumnType(_isSqlite ? "TEXT" : "jsonb");

        if (_isSqlite)
            entity.Property(e => e.OccurredAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);

        // Index: optional filter by component on replay.
        entity.HasIndex(e => new { e.Component, e.Id })
              .HasDatabaseName("ix_cse_component_id");
    }
}
