using Microsoft.Extensions.Configuration;

namespace Dashboard.Shared.Configuration;

/// <summary>
/// <see cref="IConfigurationSource"/> that registers a
/// <see cref="PostgresConnectionStringProvider"/> against the supplied
/// <paramref name="configuration"/>.
/// </summary>
/// <remarks>
/// Pass <c>builder.Configuration</c> (the live <see cref="ConfigurationManager"/>)
/// so the provider can read the full, up-to-date provider chain at value-access time.
/// </remarks>
public sealed class PostgresConnectionStringSource : IConfigurationSource
{
    private readonly IConfiguration _configuration;

    public PostgresConnectionStringSource(IConfiguration configuration) =>
        _configuration = configuration;

    public IConfigurationProvider Build(IConfigurationBuilder builder) =>
        new PostgresConnectionStringProvider(_configuration);
}
