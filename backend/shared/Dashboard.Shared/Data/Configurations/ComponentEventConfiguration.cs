using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class ComponentEventConfiguration : IEntityTypeConfiguration<ComponentEvent>
{
    private readonly bool _isSqlite;

    internal ComponentEventConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<ComponentEvent> entity)
    {
        entity.ToTable("component_events");

        // PK — UUIDv7, application-assigned; sort key.
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id)
              .HasColumnName("id")
              .HasColumnType("uuid")
              .ValueGeneratedNever();

        entity.Property(e => e.ComponentId)
              .HasColumnName("component_id")
              .IsRequired();

        entity.Property(e => e.EventType)
              .HasColumnName("event_type")
              .IsRequired();

        entity.Property(e => e.State)
              .HasColumnName("state")
              .IsRequired();

        entity.Property(e => e.Detail)
              .HasColumnName("detail")
              .HasMaxLength(512);

        // occurred_at is component-supplied (mirrors happened_at); received_at is server-assigned.
        entity.Property(e => e.OccurredAt)
              .HasColumnName("occurred_at")
              .HasColumnType("timestamptz")
              .IsRequired();

        entity.Property(e => e.ReceivedAt)
              .HasColumnName("received_at")
              .HasColumnType("timestamptz")
              .IsRequired();

        // Opaque blob, stored verbatim. jsonb on Postgres; plain text on SQLite (no jsonb type).
        entity.Property(e => e.Payload)
              .HasColumnName("payload")
              .HasColumnType(_isSqlite ? "TEXT" : "jsonb");

        if (_isSqlite)
        {
            entity.Property(e => e.OccurredAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);
            entity.Property(e => e.ReceivedAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);
        }

        // Nullable: from optional X-Correlation-Id header; opaque ≤ 128 chars; echo-only.
        entity.Property(e => e.CorrelationId)
              .HasColumnName("correlation_id")
              .HasMaxLength(128);

        // Index: per-component listing + filter.
        entity.HasIndex(e => new { e.ComponentId, e.ReceivedAt, e.Id })
              .IsDescending(false, true, true)
              .HasDatabaseName("ix_ce_component_received_id");

        // Index: global listing + cursor pagination.
        entity.HasIndex(e => new { e.ReceivedAt, e.Id })
              .IsDescending(true, true)
              .HasDatabaseName("ix_ce_received_id");

        // Partial index: correlation_id lookup for reset-ack gating (only rows that carry one).
        entity.HasIndex(e => e.CorrelationId)
              .HasDatabaseName("ix_ce_correlation_id")
              .HasFilter("correlation_id IS NOT NULL");
    }
}
