using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Dashboard.Api.Tests;

/// <summary>
/// Proves the <c>20260630222757_AddDeploymentEventDedupKey</c> migration:
///
/// <list type="number">
///   <item>Deduplicates pre-existing rows — when multiple rows share the natural key
///     <c>(deployment_id, status, happened_at)</c>, the one with the lowest <c>id</c>
///     survives and all others are deleted.</item>
///   <item>Leaves non-duplicate rows (different status or happened_at) untouched.</item>
///   <item>Creates the unique index <c>ux_de_dedup_natural_key</c> so that a subsequent
///     INSERT with the same natural key is rejected with Postgres SqlState <c>23505</c>.</item>
/// </list>
///
/// Uses its own isolated Postgres container so the migration state is independent
/// from the shared <see cref="Helpers.PostgresFixture"/> used by other suites.
/// </summary>
public sealed class MigrationDedupTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container =
        new PostgreSqlBuilder("postgres:16-alpine").Build();

    private string _connectionString = null!;

    // EF migration names — the full string name without the .cs extension.
    private const string PreDedupMigration = "20260618120000_AddNamespaceToDeploymentEvents";
    private const string DedupMigration = "20260630222757_AddDeploymentEventDedupKey";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task MigrateToAsync(string targetMigration)
    {
        var services = new ServiceCollection();
        services.AddDbContext<DashboardDbContext>(o => o.UseNpgsql(_connectionString));
        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var migrator = ctx.GetInfrastructure().GetRequiredService<IMigrator>();
        await migrator.MigrateAsync(targetMigration);
    }

    // ── Dedup pass — keeps lowest id per natural key ──────────────────────────

    /// <summary>
    /// Scenario: seed two rows with the identical natural key (Row A, Row B)
    /// plus one row with a different status (Row C) and one with a different
    /// happened_at (Row D).  After applying the migration:
    /// <list type="bullet">
    ///   <item>Row A survives (lowest id in the natural-key group).</item>
    ///   <item>Row B is deleted (higher id in the same group).</item>
    ///   <item>Row C survives (different status → different natural key).</item>
    ///   <item>Row D survives (different happened_at → different natural key).</item>
    /// </list>
    /// </summary>
    [Fact]
    public async Task Migration_DeduplicatesRows_KeepsLowestId()
    {
        // ── Step 1: migrate to state immediately before AddDeploymentEventDedupKey ──
        await MigrateToAsync(PreDedupMigration);

        // ── Step 2: seed rows via raw SQL ─────────────────────────────────────
        // Use fixed UUIDs so the ordering is deterministic; Row A (lower) survives.
        const string depId = "dup-dep-migration";
        const string sharedTs = "2026-06-01T10:00:00+00:00";
        const string differentTs = "2026-06-01T11:00:00+00:00";

        // Row A — lower id → keeps this one
        const string idA = "aaaaaaaa-0000-0000-0000-000000000001";
        // Row B — higher id, same natural key → deleted
        const string idB = "aaaaaaaa-0000-0000-0000-000000000002";
        // Row C — same deployment_id but different status → distinct natural key → kept
        const string idC = "aaaaaaaa-0000-0000-0000-000000000003";
        // Row D — same deployment_id and status but different happened_at → distinct → kept
        const string idD = "aaaaaaaa-0000-0000-0000-000000000004";

        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            foreach (var (id, status, happenedAt) in new[]
            {
                (idA, "success",     sharedTs),
                (idB, "success",     sharedTs),     // same natural key as A → duplicate
                (idC, "in-progress", sharedTs),     // different status
                (idD, "success",     differentTs),  // different happened_at
            })
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at)
VALUES
    (@id::uuid, @dep_id, 'svc', 'prod', @status, @happened_at::timestamptz)";
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("dep_id", depId);
                cmd.Parameters.AddWithValue("status", status);
                cmd.Parameters.AddWithValue("happened_at", happenedAt);
                await cmd.ExecuteNonQueryAsync();
            }
        }

        // ── Step 3: apply AddDeploymentEventDedupKey ─────────────────────────
        await MigrateToAsync(DedupMigration);

        // ── Step 4: verify the surviving rows ────────────────────────────────
        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            await using var countCmd = conn.CreateCommand();
            countCmd.CommandText = "SELECT COUNT(*) FROM deployment_events WHERE deployment_id = @dep_id";
            countCmd.Parameters.AddWithValue("dep_id", depId);
            var count = (long)(await countCmd.ExecuteScalarAsync())!;

            // A, C, D survive; B is deleted.
            Assert.Equal(3, count);

            // Row A (lowest id) must be present.
            await using var aCmd = conn.CreateCommand();
            aCmd.CommandText = "SELECT COUNT(*) FROM deployment_events WHERE id = @id::uuid";
            aCmd.Parameters.AddWithValue("id", idA);
            var aCount = (long)(await aCmd.ExecuteScalarAsync())!;
            Assert.Equal(1, aCount);

            // Row B (duplicate, higher id) must have been deleted.
            await using var bCmd = conn.CreateCommand();
            bCmd.CommandText = "SELECT COUNT(*) FROM deployment_events WHERE id = @id::uuid";
            bCmd.Parameters.AddWithValue("id", idB);
            var bCount = (long)(await bCmd.ExecuteScalarAsync())!;
            Assert.Equal(0, bCount);
        }
    }

    // ── Unique index blocks new duplicate inserts ─────────────────────────────

    /// <summary>
    /// After the migration is applied the unique index <c>ux_de_dedup_natural_key</c>
    /// must reject any INSERT that would create a row sharing
    /// <c>(deployment_id, status, happened_at)</c> with an existing row.
    /// Postgres raises SqlState <c>23505</c> for unique-constraint violations.
    /// </summary>
    [Fact]
    public async Task Migration_UniqueIndex_RejectsDuplicateInsert()
    {
        // Apply all migrations including the dedup one.
        await MigrateToAsync(DedupMigration);

        const string depId = "unique-index-dep";
        const string happenedAt = "2026-06-20T08:00:00+00:00";

        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            // Insert the first row — must succeed.
            await using var first = conn.CreateCommand();
            first.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at)
VALUES
    (gen_random_uuid(), @dep_id, 'svc', 'prod', 'success', @happened_at::timestamptz)";
            first.Parameters.AddWithValue("dep_id", depId);
            first.Parameters.AddWithValue("happened_at", happenedAt);
            await first.ExecuteNonQueryAsync();

            // A second INSERT with the same (deployment_id, status, happened_at) must fail.
            await using var second = conn.CreateCommand();
            second.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at)
VALUES
    (gen_random_uuid(), @dep_id, 'svc', 'prod', 'success', @happened_at::timestamptz)";
            second.Parameters.AddWithValue("dep_id", depId);
            second.Parameters.AddWithValue("happened_at", happenedAt);

            var ex = await Assert.ThrowsAsync<PostgresException>(
                () => second.ExecuteNonQueryAsync());

            // 23505 = unique_violation in the PostgreSQL error code table.
            Assert.Equal("23505", ex.SqlState);
        }
    }
}
