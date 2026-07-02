using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class ProvidedPresetConfiguration : IEntityTypeConfiguration<ProvidedPreset>
{
    private readonly bool _isSqlite;

    internal ProvidedPresetConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<ProvidedPreset> entity)
    {
        entity.ToTable("provided_presets");

        // Composite key: a source's bundle is authoritative-replace, keyed by (source, name).
        entity.HasKey(e => new { e.Source, e.Name });

        entity.Property(e => e.Source)
              .HasColumnName("source")
              .IsRequired();

        entity.Property(e => e.Name)
              .HasColumnName("name")
              .IsRequired();

        entity.Property(e => e.Version)
              .HasColumnName("version")
              .IsRequired();

        // Opaque blob, stored verbatim. jsonb on Postgres; plain text on SQLite (no jsonb type).
        entity.Property(e => e.SettingsJson)
              .HasColumnName("settings_json")
              .HasColumnType(_isSqlite ? "TEXT" : "jsonb")
              .IsRequired();

        entity.Property(e => e.FetchedAt)
              .HasColumnName("fetched_at")
              .HasColumnType("timestamptz")
              .IsRequired();

        if (_isSqlite)
            entity.Property(e => e.FetchedAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);
    }
}
