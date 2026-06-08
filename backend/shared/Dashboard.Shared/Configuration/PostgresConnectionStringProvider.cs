using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Primitives;

namespace Dashboard.Shared.Configuration;

/// <summary>
/// <see cref="IConfigurationProvider"/> that exposes a single synthetic key
/// <c>ConnectionStrings:Postgres</c> computed on demand from the flat <c>POSTGRES_*</c>
/// environment variables (or appsettings <c>Postgres:*</c> section) via
/// <see cref="PostgresConnectionString.Resolve"/>.
///
/// Holds a reference to the live <see cref="IConfiguration"/> root so that value
/// resolution always reflects the current, fully-assembled provider chain — including
/// providers added AFTER initial host configuration (e.g., test-harness in-memory
/// collections injected by <see cref="Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory{TEntryPoint}"/>).
///
/// Designed to be added LAST in the configuration chain so it has the highest priority
/// and overrides any static <c>ConnectionStrings:Postgres</c> entry from other sources.
/// </summary>
internal sealed class PostgresConnectionStringProvider : IConfigurationProvider
{
    private const string ConnectionStringKey = "ConnectionStrings:Postgres";

    private readonly IConfiguration _configuration;

    internal PostgresConnectionStringProvider(IConfiguration configuration) =>
        _configuration = configuration;

    public bool TryGet(string key, out string? value)
    {
        if (!key.Equals(ConnectionStringKey, StringComparison.OrdinalIgnoreCase))
        {
            value = null;
            return false;
        }

        var authMode = NpgsqlDataSourceFactory.ResolveAuthMode(_configuration);
        value = PostgresConnectionString.Resolve(_configuration, authMode);
        return true;
    }

    public void Set(string key, string? value) { /* read-only synthetic key */ }

    public void Load() { /* no data source to load */ }

    public IEnumerable<string> GetChildKeys(IEnumerable<string> earlierKeys, string? parentPath) =>
        Enumerable.Empty<string>();

    public IChangeToken GetReloadToken() => new CancellationChangeToken(CancellationToken.None);
}
