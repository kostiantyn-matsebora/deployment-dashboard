using Microsoft.Extensions.Configuration;

namespace Dashboard.Shared.Configuration;

/// <summary>
/// Resolves a Npgsql connection string from flat <c>POSTGRES_*</c> environment variables
/// or an appsettings <c>Postgres</c> section, with hardcoded defaults as the final fallback.
/// </summary>
/// <remarks>
/// Resolution precedence (highest → lowest) for each part:
/// <list type="number">
///   <item><c>POSTGRES_HOST</c> / <c>POSTGRES_PORT</c> / <c>POSTGRES_DB</c> /
///         <c>POSTGRES_USER</c> / <c>POSTGRES_PASSWORD</c> environment variables.</item>
///   <item>Appsettings <c>Postgres:Host</c> / <c>Postgres:Port</c> / <c>Postgres:Database</c> /
///         <c>Postgres:Username</c> / <c>Postgres:Password</c> keys.</item>
///   <item>Built-in defaults: <c>Host=postgres</c>, <c>Port=5432</c>,
///         <c>Database=deployment_dashboard</c>, empty username/password.</item>
/// </list>
/// <para>
/// This helper is the single authoritative source for connection-string assembly.
/// All callers — <c>Program.cs</c>, design-time EF factory, test harness — must go
/// through it; no ad-hoc string concatenation elsewhere.
/// </para>
/// </remarks>
public static class PostgresConnectionString
{
    private const string DefaultHost = "postgres";
    private const string DefaultPort = "5432";
    private const string DefaultDatabase = "deployment_dashboard";

    /// <summary>
    /// Resolves and assembles the Npgsql connection string from <paramref name="configuration"/>.
    /// </summary>
    public static string Resolve(IConfiguration configuration)
    {
        var host = Resolve(configuration, "POSTGRES_HOST", "Postgres:Host", DefaultHost);
        var port = Resolve(configuration, "POSTGRES_PORT", "Postgres:Port", DefaultPort);
        var database = Resolve(configuration, "POSTGRES_DB", "Postgres:Database", DefaultDatabase);
        var username = Resolve(configuration, "POSTGRES_USER", "Postgres:Username", string.Empty);
        var password = Resolve(configuration, "POSTGRES_PASSWORD", "Postgres:Password", string.Empty);

        return $"Host={host};Port={port};Database={database};Username={username};Password={password}";
    }

    /// <summary>
    /// Returns the first non-null/non-whitespace value found in order:
    /// env var → appsettings key → <paramref name="defaultValue"/>.
    /// </summary>
    private static string Resolve(
        IConfiguration configuration,
        string envKey,
        string configKey,
        string defaultValue)
    {
        var envValue = configuration[envKey];
        if (!string.IsNullOrWhiteSpace(envValue))
            return envValue;

        var configValue = configuration[configKey];
        if (!string.IsNullOrWhiteSpace(configValue))
            return configValue;

        return defaultValue;
    }
}
