using Dashboard.Shared.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dashboard.Shared.Data.Configurations;

internal sealed class FetcherStateConfiguration : IEntityTypeConfiguration<FetcherState>
{
    private readonly bool _isSqlite;

    internal FetcherStateConfiguration(bool isSqlite) => _isSqlite = isSqlite;

    public void Configure(EntityTypeBuilder<FetcherState> entity)
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

        if (_isSqlite)
            entity.Property(e => e.UpdatedAt).HasConversion(ValueConverters.DateTimeOffsetToUnixMs);
    }
}
