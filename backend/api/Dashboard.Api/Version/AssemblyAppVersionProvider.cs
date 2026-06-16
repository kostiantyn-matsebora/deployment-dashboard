using System.Reflection;

namespace Dashboard.Api.Version;

/// <summary>
/// Returns <see cref="AssemblyInformationalVersionAttribute.InformationalVersion"/> of the
/// entry assembly, stripping any <c>+&lt;build-metadata&gt;</c> suffix appended by SourceLink.
/// Falls back to <c>"0.0.0-dev"</c> when the attribute is absent or empty.
/// </summary>
internal sealed class AssemblyAppVersionProvider : IAppVersionProvider
{
    private const string Fallback = "0.0.0-dev";

    public string Version { get; } = Resolve();

    private static string Resolve()
    {
        var raw = Assembly.GetEntryAssembly()
            ?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion;

        if (string.IsNullOrEmpty(raw))
            return Fallback;

        // Strip +<build-metadata> (e.g. "+abc1234" appended by SourceLink).
        var plusIndex = raw.IndexOf('+', StringComparison.Ordinal);
        return plusIndex >= 0 ? raw[..plusIndex] : raw;
    }
}
