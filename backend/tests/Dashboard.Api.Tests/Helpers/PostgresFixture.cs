using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Respawn;
using Testcontainers.PostgreSql;

namespace Dashboard.Api.Tests.Helpers;

/// <summary>
/// Assembly-scoped fixture: one Postgres container for the entire test run.
/// Migrations run once; <see cref="ResetAsync"/> truncates all app tables between
/// test classes using Respawn (no-op on <c>reset_cycle</c> which is re-seeded after
/// each truncation so the single-row invariant is restored).
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:16-alpine")
        .Build();

    private Respawner _respawner = null!;

    public string ConnectionString { get; private set; } = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        ConnectionString = _container.GetConnectionString();

        // Run EF migrations once against the shared container.
        var optionsBuilder = new DbContextOptionsBuilder<DashboardDbContext>();
        optionsBuilder.UseNpgsql(ConnectionString);
        await using var ctx = new DashboardDbContext(optionsBuilder.Options);
        await ctx.Database.MigrateAsync();

        // Build the Respawn checkpoint after migrations so all tables exist.
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            // Preserve EF's migration history: the API auto-migrates on startup
            // (Dashboard.Api/Program.cs), so wiping it would make every
            // WebApplicationFactory boot re-create the (already-present) tables → 42P07.
            TablesToIgnore = [new Respawn.Graph.Table("public", "__EFMigrationsHistory")],
        });
    }

    /// <summary>
    /// Truncates all app tables and re-seeds the <c>reset_cycle</c> singleton row
    /// so each test class starts with a clean, consistent database state.
    /// </summary>
    public async Task ResetAsync()
    {
        await using var conn = new NpgsqlConnection(ConnectionString);
        await conn.OpenAsync();
        await _respawner.ResetAsync(conn);

        // Re-seed the migration-required singleton row.
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "INSERT INTO reset_cycle (id, state) VALUES (1, 'idle') ON CONFLICT DO NOTHING";
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task DisposeAsync() => await _container.DisposeAsync();
}
