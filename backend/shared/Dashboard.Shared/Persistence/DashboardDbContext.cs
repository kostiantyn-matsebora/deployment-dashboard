using System.Text.Json;
using Dashboard.Shared.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Dashboard.Shared.Persistence;

/// <summary>
/// Single EF Core <c>DbContext</c> shared by Write API and Read API
/// (per CLAUDE.md repository structure — one migration set serves both APIs).
///
/// <para>The <c>parent_deployments</c> column maps to <c>text[]</c> on
/// PostgreSQL (handled natively by Npgsql) and to a JSON-encoded string on
/// SQLite (used by unit tests). The provider is detected at model-build
/// time via <see cref="DatabaseFacade.ProviderName"/> so the same entity
/// works against both stacks without conditional compilation.</para>
/// </summary>
public sealed class DashboardDbContext : DbContext
{
    public DashboardDbContext(DbContextOptions<DashboardDbContext> options) : base(options) { }

    public DbSet<DeploymentEntity> Deployments => Set<DeploymentEntity>();

    /// <summary>
    /// Opaque per-<c>progress_reporter</c> cursor table (CR-0009 + ADR-0004).
    /// Keyed by the composite (<c>progress_reporter</c>, <c>source_id</c>) —
    /// see <see cref="FetcherStateEntity"/>.
    /// </summary>
    public DbSet<FetcherStateEntity> FetcherStates => Set<FetcherStateEntity>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        var deployment = modelBuilder.Entity<DeploymentEntity>();

        deployment.ToTable("deployments");
        deployment.HasKey(e => e.Id);

        // Identity generation strategies differ between providers but the EF
        // mapping is the same; the provider-specific config is applied in the
        // migration via raw SQL.
        deployment.Property(e => e.Id).ValueGeneratedOnAdd();

        deployment.Property(e => e.DeploymentId).IsRequired();
        deployment.Property(e => e.Service).IsRequired();
        deployment.Property(e => e.Environment).IsRequired();
        deployment.Property(e => e.Version).IsRequired();
        deployment.Property(e => e.Status).IsRequired();
        deployment.Property(e => e.RunUrl).IsRequired();
        deployment.Property(e => e.Actor).IsRequired();
        deployment.Property(e => e.DeployedAt).IsRequired();

        // SAD §7 data model + FR-05: ref and sha are independent optional
        // string fields. Both map to nullable text in both providers (no
        // length cap at this stage — stricter validation is a deferred
        // follow-up per SAD §10 Decision 10). Two SEPARATE columns: they are
        // not paired, callers may send one without the other.
        deployment.Property(e => e.Ref)
                  .HasColumnName("ref")
                  .HasColumnType("text")
                  .IsRequired(false);

        deployment.Property(e => e.Sha)
                  .HasColumnName("sha")
                  .HasColumnType("text")
                  .IsRequired(false);

        // CR-0009: optional pusher-attribution token captured from the
        // X-Progress-Reporter request header. Cap matches the header
        // validation (64 chars); nullable on the wire and in storage so
        // existing pre-CR-0009 rows materialise as NULL with no backfill.
        deployment.Property(e => e.ProgressReporter)
                  .HasColumnName("progress_reporter")
                  .HasMaxLength(64)
                  .IsRequired(false);

        var parentDeployments = deployment.Property(e => e.ParentDeployments).IsRequired();

        // SQLite has no array type, so unit tests serialise the array as a
        // JSON string and round-trip it through a value converter. PostgreSQL
        // (Npgsql) maps List<string> -> text[] natively, so no converter is
        // needed there — the absence of the converter is itself part of the
        // contract (it preserves Postgres array semantics for downstream
        // queries).
        if (Database.IsSqlite())
        {
            parentDeployments
                .HasColumnType("TEXT")
                .HasConversion(JsonListConverter, JsonListComparer);
        }
        else
        {
            // Postgres path — Npgsql provider sees text[] on the model and
            // emits the correct array bindings in the migration.
            parentDeployments.HasColumnType("text[]");
        }

        // Matrix query index from SAD §7 "Indexes".
        // The (service, environment, deployed_at DESC) shape supports both
        // the matrix DISTINCT ON query and the per-slot history scan.
        deployment.HasIndex(e => new { e.Service, e.Environment, e.DeployedAt })
                  .HasDatabaseName("ix_deployments_service_environment_deployed_at");

        // SAD §7 "Indexes": UNIQUE (service, deployment_id) — required so
        // parent_deployments references resolve unambiguously, and so the
        // Write API can return 409 Conflict on duplicate posts.
        deployment.HasIndex(e => new { e.Service, e.DeploymentId })
                  .IsUnique()
                  .HasDatabaseName("ux_deployments_service_deployment_id");

        // Topology lookup index — hot path for the topology builder when
        // resolving explicit parents (SAD §7 "Indexes"). The unique index
        // above already covers it, but we name the SAD-required index
        // separately for self-documenting query plans.
        // Note: the unique index is sufficient as a single (service, deployment_id) BTREE
        // — declaring a second non-unique index over the same columns would be redundant.

        // Topology builder configuration (Read API also persists it).
        modelBuilder.Entity<TopologyConfigRow>(b =>
        {
            b.ToTable("topology_config");
            b.HasKey(e => e.Id);
            b.Property(e => e.Id).HasColumnName("id").ValueGeneratedNever();
            b.Property(e => e.CorrelationAttribute).HasColumnName("correlation_attribute").IsRequired();

            if (Database.IsSqlite())
            {
                b.Property(e => e.PerServiceOverridesJson)
                    .HasColumnName("per_service_overrides")
                    .HasColumnType("TEXT")
                    .IsRequired();
            }
            else
            {
                b.Property(e => e.PerServiceOverridesJson)
                    .HasColumnName("per_service_overrides")
                    .HasColumnType("jsonb")
                    .IsRequired();
            }
        });

        // CR-0009 + ADR-0004: opaque per-progress_reporter cursor table.
        // Composite key (progress_reporter, source_id); the cursor blob is
        // never parsed by the backend (length-capped string only); updated_at
        // is server-stamped on every upsert.
        modelBuilder.Entity<FetcherStateEntity>(b =>
        {
            b.ToTable("fetcher_state");

            b.HasKey(e => new { e.ProgressReporter, e.SourceId });

            b.Property(e => e.ProgressReporter)
                .HasColumnName("progress_reporter")
                .HasMaxLength(64)
                .IsRequired();

            b.Property(e => e.SourceId)
                .HasColumnName("source_id")
                .HasMaxLength(200)
                .IsRequired();

            b.Property(e => e.Cursor)
                .HasColumnName("cursor")
                .HasMaxLength(4096)
                .IsRequired();

            // Stored as `timestamp with time zone` on Postgres (matches the
            // existing deployed_at convention) and TEXT-ISO on SQLite.
            if (Database.IsSqlite())
            {
                b.Property(e => e.UpdatedAt)
                    .HasColumnName("updated_at")
                    .HasColumnType("TEXT")
                    .IsRequired();
            }
            else
            {
                b.Property(e => e.UpdatedAt)
                    .HasColumnName("updated_at")
                    .HasColumnType("timestamp with time zone")
                    .IsRequired();
            }
        });
    }

    public DbSet<TopologyConfigRow> TopologyConfigs => Set<TopologyConfigRow>();

    private static readonly ValueConverter<List<string>, string> JsonListConverter = new(
        v => JsonSerializer.Serialize(v, JsonOptions),
        v => string.IsNullOrEmpty(v)
            ? new List<string>()
            : JsonSerializer.Deserialize<List<string>>(v, JsonOptions) ?? new List<string>());

    private static readonly ValueComparer<List<string>> JsonListComparer = new(
        (a, b) => SequenceEqual(a, b),
        v => v == null ? 0 : v.Aggregate(0, (h, s) => HashCode.Combine(h, s)),
        v => v == null ? new List<string>() : new List<string>(v));

    private static bool SequenceEqual(List<string>? a, List<string>? b)
    {
        if (ReferenceEquals(a, b)) return true;
        if (a is null || b is null) return false;
        if (a.Count != b.Count) return false;
        for (var i = 0; i < a.Count; i++)
        {
            if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
        }
        return true;
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.Never,
    };
}

/// <summary>
/// Single-row persisted record holding the active topology correlation
/// configuration (SAD §7 "Configuration — Read API topology"). The Read API
/// bootstraps this row from <c>appsettings.json</c> on first run and updates
/// it via <c>PATCH /api/config/topology</c>. <see cref="PerServiceOverridesJson"/>
/// is a JSON object encoded as text so the same schema works on both
/// PostgreSQL (<c>jsonb</c>) and SQLite (<c>TEXT</c>).
/// </summary>
public sealed class TopologyConfigRow
{
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;
    public string CorrelationAttribute { get; set; } = "version";
    public string PerServiceOverridesJson { get; set; } = "{}";
}
