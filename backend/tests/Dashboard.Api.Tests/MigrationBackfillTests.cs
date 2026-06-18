using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;

namespace Dashboard.Api.Tests;

/// <summary>
/// Proves that the <c>20260618120000_AddNamespaceToDeploymentEvents</c> migration's
/// backfill UPDATE correctly populates <c>namespace</c> from <c>run_url</c> for every
/// supported host pattern (github.com, api.github.com, GitHub Enterprise, local emulator)
/// and correctly leaves <c>namespace = NULL</c> for rows that have no <c>/actions/</c>
/// segment or a NULL <c>run_url</c>.
///
/// Uses its own isolated Postgres container so it can control the migration state
/// independently from the shared <see cref="Helpers.PostgresFixture"/> used by other suites.
/// </summary>
public sealed class MigrationBackfillTests : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .Build();

    private string _connectionString = null!;

    // EF migration names (the full string, not the timestamp prefix alone).
    private const string PreNamespaceMigration = "20260606140000_RenameResetIdToCorrelationId";
    private const string NamespaceMigration = "20260618120000_AddNamespaceToDeploymentEvents";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _connectionString = _container.GetConnectionString();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: resolve IMigrator from a DashboardDbContext wired to the container.
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // End-to-end: apply migrations up to the pre-namespace state, insert rows,
    // apply the namespace migration, assert backfill results.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Backfill_PopulatesNamespace_ForAllSupportedRunUrlPatterns()
    {
        // ── Step 1: migrate to the state before AddNamespaceToDeploymentEvents ──
        await MigrateToAsync(PreNamespaceMigration);

        // ── Step 2: insert rows via raw SQL — namespace column does not exist yet ──
        // Each row uses a unique string-based deployment_id so there are no PK conflicts.
        var rows = new[]
        {
            // (deployment_id, run_url, expected_namespace)
            (
                $"dep-{Guid.NewGuid():N}",
                "https://github.com/acme-org/my-repo/actions/runs/12345",
                (string?)"my-repo"
            ),
            (
                $"dep-{Guid.NewGuid():N}",
                "http://github-emulator:3100/repos/acme-org/emulator-repo/actions/runs/99",
                (string?)"emulator-repo"
            ),
            (
                $"dep-{Guid.NewGuid():N}",
                "https://api.github.com/repos/acme-org/api-repo/actions/runs/7",
                (string?)"api-repo"
            ),
            (
                $"dep-{Guid.NewGuid():N}",
                "https://github.example.com/acme-org/enterprise-repo/actions/runs/42",
                (string?)"enterprise-repo"
            ),
            (
                // no /actions/ segment — namespace must stay NULL
                $"dep-{Guid.NewGuid():N}",
                (string?)"https://github.com/acme-org/some-repo/commits/abc123",
                (string?)null
            ),
            (
                // NULL run_url — namespace must stay NULL
                $"dep-{Guid.NewGuid():N}",
                (string?)null,
                (string?)null
            ),
        };

        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            foreach (var (deploymentId, runUrl, _) in rows)
            {
                await using var cmd = conn.CreateCommand();

                if (runUrl is null)
                {
                    cmd.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at)
VALUES
    (gen_random_uuid(), @dep_id, 'svc', 'prod', 'success', now())";
                    cmd.Parameters.AddWithValue("dep_id", deploymentId);
                }
                else
                {
                    cmd.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at, run_url)
VALUES
    (gen_random_uuid(), @dep_id, 'svc', 'prod', 'success', now(), @run_url)";
                    cmd.Parameters.AddWithValue("dep_id", deploymentId);
                    cmd.Parameters.AddWithValue("run_url", runUrl);
                }

                await cmd.ExecuteNonQueryAsync();
            }
        }

        // ── Step 3: apply AddNamespaceToDeploymentEvents ──
        await MigrateToAsync(NamespaceMigration);

        // ── Step 4: assert backfill results ──
        await using var readConn = new NpgsqlConnection(_connectionString);
        await readConn.OpenAsync();

        foreach (var (deploymentId, runUrl, expectedNamespace) in rows)
        {
            await using var cmd = readConn.CreateCommand();
            cmd.CommandText = "SELECT namespace FROM deployment_events WHERE deployment_id = @dep_id";
            cmd.Parameters.AddWithValue("dep_id", deploymentId);

            var raw = await cmd.ExecuteScalarAsync();
            var actualNamespace = raw is DBNull ? null : (string?)raw;

            Assert.True(
                expectedNamespace == actualNamespace,
                $"namespace mismatch for run_url '{runUrl ?? "(null)"}':" +
                $" expected='{expectedNamespace ?? "null"}', actual='{actualNamespace ?? "null"}'");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Sanity-check the test has teeth: the old github.com-only LIKE pattern
    // misses emulator and enterprise rows (leaves them NULL), whereas the fixed
    // host-agnostic pattern (used by the real migration) correctly populates them.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Backfill_OldGithubComOnlyRegex_MissesEmulatorAndEnterpriseRows()
    {
        // Apply all migrations including the namespace one so the column exists.
        await MigrateToAsync(NamespaceMigration);

        var emulatorDepId = $"sanity-{Guid.NewGuid():N}";
        var enterpriseDepId = $"sanity-{Guid.NewGuid():N}";

        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            foreach (var (depId, runUrl) in new[]
            {
                (emulatorDepId,   "http://github-emulator:3100/repos/org/emu-repo/actions/runs/1"),
                (enterpriseDepId, "https://github.example.com/org/ent-repo/actions/runs/2"),
            })
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
INSERT INTO deployment_events
    (id, deployment_id, service, environment, status, happened_at, run_url)
VALUES
    (gen_random_uuid(), @dep_id, 'svc', 'prod', 'success', now(), @run_url)";
                cmd.Parameters.AddWithValue("dep_id", depId);
                cmd.Parameters.AddWithValue("run_url", runUrl);
                await cmd.ExecuteNonQueryAsync();
            }

            // Apply the OLD backfill: github.com-only LIKE predicate.
            await using var oldBackfill = conn.CreateCommand();
            oldBackfill.CommandText = @"
UPDATE deployment_events
SET    namespace = (regexp_match(run_url, '/([^/]+)/actions/'))[1]
WHERE  run_url IS NOT NULL
  AND  run_url LIKE 'https://github.com/%/actions/%'";
            await oldBackfill.ExecuteNonQueryAsync();
        }

        // Both non-github.com rows must remain NULL under the old pattern.
        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            foreach (var (depId, label) in new[]
            {
                (emulatorDepId,   "emulator"),
                (enterpriseDepId, "enterprise"),
            })
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT namespace FROM deployment_events WHERE deployment_id = @dep_id";
                cmd.Parameters.AddWithValue("dep_id", depId);

                var raw = await cmd.ExecuteScalarAsync();
                var ns = raw is DBNull ? null : (string?)raw;

                Assert.True(ns is null,
                    $"OLD regex unexpectedly populated namespace='{ns}' for {label} row " +
                    $"— this assertion confirms the test has teeth");
            }
        }

        // Now apply the FIXED (host-agnostic) backfill SQL and confirm it populates both rows.
        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();
            await using var fixedBackfill = conn.CreateCommand();
            fixedBackfill.CommandText = @"
UPDATE deployment_events
SET    namespace = (regexp_match(run_url, '/([^/]+)/actions/'))[1]
WHERE  run_url IS NOT NULL
  AND  run_url LIKE '%/actions/%'";
            await fixedBackfill.ExecuteNonQueryAsync();
        }

        await using (var conn = new NpgsqlConnection(_connectionString))
        {
            await conn.OpenAsync();

            var expected = new Dictionary<string, string>
            {
                [emulatorDepId]   = "emu-repo",
                [enterpriseDepId] = "ent-repo",
            };

            foreach (var (depId, expectedNs) in expected)
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT namespace FROM deployment_events WHERE deployment_id = @dep_id";
                cmd.Parameters.AddWithValue("dep_id", depId);

                var raw = await cmd.ExecuteScalarAsync();
                var actualNs = raw is DBNull ? null : (string?)raw;

                Assert.True(
                    expectedNs == actualNs,
                    $"fixed regex failed for deployment_id '{depId}':" +
                    $" expected='{expectedNs}', actual='{actualNs ?? "null"}'");
            }
        }
    }
}
