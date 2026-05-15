using Dashboard.Shared.Persistence;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Shared.Tests.Persistence;

/// <summary>
/// Lightweight harness that spins up a fresh SQLite in-memory database per
/// test (per backend-engineer agent rules: "Unit tests → SQLite in-memory,
/// not Testcontainers, not mocked DbContext"). The caller owns the
/// returned <see cref="DashboardDbContext"/> and the underlying
/// <see cref="SqliteConnection"/> via the <see cref="Handle"/> wrapper.
/// </summary>
public static class InMemorySqliteContext
{
    public static Handle Create()
    {
        // Connection-shared mode keeps the in-memory db alive for the
        // lifetime of the connection rather than per-command.
        var conn = new SqliteConnection("DataSource=:memory:");
        conn.Open();

        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite(conn)
            .Options;

        var ctx = new DashboardDbContext(options);
        ctx.Database.EnsureCreated();
        return new Handle(conn, ctx);
    }

    public sealed class Handle : IDisposable
    {
        public SqliteConnection Connection { get; }
        public DashboardDbContext Context { get; }

        internal Handle(SqliteConnection conn, DashboardDbContext ctx)
        {
            Connection = conn;
            Context = ctx;
        }

        public void Dispose()
        {
            Context.Dispose();
            Connection.Dispose();
        }
    }
}
