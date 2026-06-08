using Microsoft.Extensions.Configuration;
using Npgsql;

namespace Dashboard.Shared.Configuration;

/// <summary>
/// Single seam for creating a configured <see cref="NpgsqlDataSource"/>.
/// </summary>
/// <remarks>
/// Auth mode is auto-detected from credential presence — no explicit toggle required.
/// All callers — <c>Program.cs</c> (×2), <c>DashboardDbContextFactory</c>, and
/// <c>PgListenBroadcasterBase</c> — must go through this factory; no per-service
/// credential code elsewhere.
/// </remarks>
public static class NpgsqlDataSourceFactory
{
    /// <summary>
    /// Auto-detects the auth mode, assembles the connection string, and returns a
    /// ready-to-use <see cref="NpgsqlDataSource"/>.
    /// </summary>
    /// <remarks>
    /// Auth mode is resolved purely from credential presence — no explicit toggle required:
    /// <list type="bullet">
    ///   <item><c>POSTGRES_PASSWORD</c> present and non-empty → <see cref="PostgresAuthMode.Password"/>
    ///         (static credentials; behavior unchanged from pre-v2).</item>
    ///   <item><c>POSTGRES_PASSWORD</c> absent or empty → <see cref="PostgresAuthMode.ManagedIdentity"/>
    ///         (no static password; token acquired via <see cref="IPostgresTokenProvider"/> and
    ///         refreshed via <see cref="NpgsqlDataSourceBuilder.UsePeriodicPasswordProvider"/>).</item>
    /// </list>
    /// </remarks>
    /// <param name="configuration">Runtime or design-time configuration.</param>
    /// <param name="tokenProvider">
    /// Optional override for the managed-identity token provider.
    /// When <c>null</c> and auth mode resolves to <see cref="PostgresAuthMode.ManagedIdentity"/>,
    /// an <see cref="AzurePostgresTokenProvider"/> backed by <c>DefaultAzureCredential</c> is used.
    /// </param>
    public static NpgsqlDataSource Create(
        IConfiguration configuration,
        IPostgresTokenProvider? tokenProvider = null)
    {
        var authMode = ResolveAuthMode(configuration);
        var connectionString = PostgresConnectionString.Resolve(configuration, authMode);
        var builder = new NpgsqlDataSourceBuilder(connectionString);

        if (authMode == PostgresAuthMode.ManagedIdentity)
        {
            var provider = tokenProvider ?? new AzurePostgresTokenProvider();
            // ValueTask<string> — no async wrapper needed; delegate signature matches directly.
            builder.UsePeriodicPasswordProvider(
                (_, ct) => provider.GetTokenAsync(ct),
                TimeSpan.FromMinutes(5),
                TimeSpan.FromSeconds(10));
        }

        return builder.Build();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Returns <see cref="PostgresAuthMode.Password"/> when a non-empty password is configured;
    /// <see cref="PostgresAuthMode.ManagedIdentity"/> otherwise.
    /// Delegates to <see cref="PostgresConnectionString.ResolvePassword"/> so auth-mode detection
    /// and connection-string assembly share the same precedence logic.
    /// </summary>
    public static PostgresAuthMode ResolveAuthMode(IConfiguration configuration) =>
        string.IsNullOrWhiteSpace(PostgresConnectionString.ResolvePassword(configuration))
            ? PostgresAuthMode.ManagedIdentity
            : PostgresAuthMode.Password;
}
