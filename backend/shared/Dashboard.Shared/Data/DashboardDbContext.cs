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
        ConfigureDeploymentEvents(modelBuilder, isSqlite);
        ConfigureFetcherState(modelBuilder, isSqlite);
        ConfigureControlStreamEvents(modelBuilder, isSqlite);
        ConfigureComponentEvents(modelBuilder, isSqlite);
        ConfigureResetCycle(modelBuilder, isSqlite);
    }

    private static void ConfigureDeploymentEvents(ModelBuilder modelBuilder, bool isSqlite)
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

            // SQLite cannot compare or order DateTimeOffset as TEXT.
            // Store as Unix milliseconds so ordering and comparisons work correctly in tests.
            if (isSqlite)
            {
                entity.Property(e => e.HappenedAt)
                      .HasConversion<long>(
                          v => v.ToUnixTimeMilliseconds(),
                          v => DateTimeOffset.FromUnixTimeMilliseconds(v));
            }

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
        });
    }

    private static void ConfigureFetcherState(ModelBuilder modelBuilder, bool isSqlite)
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

            if (isSqlite)
            {
                entity.Property(e => e.UpdatedAt)
                      .HasConversion<long>(
                          v => v.ToUnixTimeMilliseconds(),
                          v => DateTimeOffset.FromUnixTimeMilliseconds(v));
            }
        });
    }

    private static void ConfigureControlStreamEvents(ModelBuilder modelBuilder, bool isSqlite)
    {
        modelBuilder.Entity<ControlStreamEvent>(entity =>
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

            // Nullable: present on reset-started / reset-completed; absent on reset-initiated.
            entity.Property(e => e.ResetId)
                  .HasColumnName("reset_id")
                  .HasColumnType("uuid");

            entity.Property(e => e.OccurredAt)
                  .HasColumnName("occurred_at")
                  .HasColumnType("timestamptz")
                  .IsRequired();

            if (isSqlite)
            {
                entity.Property(e => e.OccurredAt)
                      .HasConversion<long>(
                          v => v.ToUnixTimeMilliseconds(),
                          v => DateTimeOffset.FromUnixTimeMilliseconds(v));
            }

            // Index: optional filter by component on replay.
            entity.HasIndex(e => new { e.Component, e.Id })
                  .HasDatabaseName("ix_cse_component_id");
        });
    }

    private static void ConfigureResetCycle(ModelBuilder modelBuilder, bool isSqlite)
    {
        modelBuilder.Entity<ResetCycle>(entity =>
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

            entity.Property(e => e.ResetId)
                  .HasColumnName("reset_id")
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

            if (isSqlite)
            {
                entity.Property(e => e.StartedAt)
                      .HasConversion<long?>(
                          v => v == null ? (long?)null : v.Value.ToUnixTimeMilliseconds(),
                          v => v == null ? (DateTimeOffset?)null : DateTimeOffset.FromUnixTimeMilliseconds(v.Value));

                entity.Property(e => e.DeadlineAt)
                      .HasConversion<long?>(
                          v => v == null ? (long?)null : v.Value.ToUnixTimeMilliseconds(),
                          v => v == null ? (DateTimeOffset?)null : DateTimeOffset.FromUnixTimeMilliseconds(v.Value));

                // SQLite has no native array type; store as comma-delimited text.
                entity.Property(e => e.ExpectedComponents)
                      .HasConversion(
                          v => v == null ? null : string.Join(',', v),
                          v => v == null ? null : v.Split(',', StringSplitOptions.None));

                entity.Property(e => e.AcksReceived)
                      .HasConversion(
                          v => v == null ? null : string.Join(',', v),
                          v => v == null ? null : v.Split(',', StringSplitOptions.None));
            }
        });
    }

    private static void ConfigureComponentEvents(ModelBuilder modelBuilder, bool isSqlite)
    {
        modelBuilder.Entity<ComponentEvent>(entity =>
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
                  .HasColumnType(isSqlite ? "TEXT" : "jsonb");

            if (isSqlite)
            {
                entity.Property(e => e.OccurredAt)
                      .HasConversion<long>(
                          v => v.ToUnixTimeMilliseconds(),
                          v => DateTimeOffset.FromUnixTimeMilliseconds(v));
                entity.Property(e => e.ReceivedAt)
                      .HasConversion<long>(
                          v => v.ToUnixTimeMilliseconds(),
                          v => DateTimeOffset.FromUnixTimeMilliseconds(v));
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
        });
    }
}
