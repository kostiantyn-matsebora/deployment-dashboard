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
/// <b>SSL mode (<c>POSTGRES_SSL_MODE</c> / <c>Postgres:SslMode</c>).</b>
/// Resolution precedence: <c>POSTGRES_SSL_MODE</c> env var → <c>Postgres:SslMode</c> appsettings.
/// Whitespace is treated as absent (consistent with other knobs).
/// </para>
/// <list type="bullet">
///   <item>Managed-identity mode + no value configured → <c>SslMode=Require</c> appended.</item>
///   <item>Managed-identity mode + value configured → <c>SslMode=&lt;value&gt;</c> appended.</item>
///   <item>Password mode + no value configured → <c>SslMode</c> keyword omitted (unchanged).</item>
///   <item>Password mode + value configured → <c>SslMode=&lt;value&gt;</c> appended.</item>
/// </list>
/// <para>
/// The value is passed verbatim; Npgsql parses SSL mode case-insensitively.
/// </para>
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
    /// <param name="configuration">Runtime or design-time configuration.</param>
    /// <param name="authMode">
    /// Auth mode that controls whether a static password is included.
    /// When <see cref="PostgresAuthMode.ManagedIdentity"/>, the <c>Password</c> keyword
    /// is omitted so Npgsql does not send an empty credential; the password is supplied
    /// dynamically by <c>NpgsqlDataSourceFactory</c> via the periodic-password provider.
    /// Defaults to <see cref="PostgresAuthMode.Password"/> (unchanged behavior).
    /// </param>
    public static string Resolve(
        IConfiguration configuration,
        PostgresAuthMode authMode = PostgresAuthMode.Password)
    {
        var host = Resolve(configuration, "POSTGRES_HOST", "Postgres:Host", DefaultHost);
        var port = Resolve(configuration, "POSTGRES_PORT", "Postgres:Port", DefaultPort);
        var database = Resolve(configuration, "POSTGRES_DB", "Postgres:Database", DefaultDatabase);
        var username = Resolve(configuration, "POSTGRES_USER", "Postgres:Username", string.Empty);

        var sslMode = Resolve(configuration, "POSTGRES_SSL_MODE", "Postgres:SslMode", string.Empty);

        if (authMode == PostgresAuthMode.ManagedIdentity)
        {
            var effectiveSslMode = string.IsNullOrWhiteSpace(sslMode) ? "Require" : sslMode;
            return $"Host={host};Port={port};Database={database};Username={username};SslMode={effectiveSslMode}";
        }

        // Resolved via the shared helper so auth-mode detection and connection-string
        // assembly always use the same precedence (env var → appsettings → empty).
        var password = ResolvePassword(configuration);
        var sslSuffix = string.IsNullOrWhiteSpace(sslMode) ? string.Empty : $";SslMode={sslMode}";
        return $"Host={host};Port={port};Database={database};Username={username};Password={password}{sslSuffix}";
    }

    /// <summary>
    /// Resolves the effective Postgres password using the canonical precedence:
    /// <c>POSTGRES_PASSWORD</c> env var → <c>Postgres:Password</c> appsettings → empty string.
    /// Shared by <see cref="Resolve"/> and <see cref="NpgsqlDataSourceFactory.ResolveAuthMode"/>
    /// so both always agree on whether a password is configured.
    /// </summary>
    internal static string ResolvePassword(IConfiguration configuration)
    {
        var envValue = configuration["POSTGRES_PASSWORD"];
        if (!string.IsNullOrWhiteSpace(envValue))
            return envValue;

        var cfgValue = configuration["Postgres:Password"];
        return string.IsNullOrWhiteSpace(cfgValue) ? string.Empty : cfgValue;
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
