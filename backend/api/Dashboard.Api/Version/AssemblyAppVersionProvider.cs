using System.Reflection;

namespace Dashboard.Api.Version;

/// <summary>
/// Returns <see cref="AssemblyInformationalVersionAttribute.InformationalVersion"/> of the
/// entry assembly as-is (e.g. <c>v0.13.1</c> for a release build, <c>main+a947098</c> for
/// a CI build). Falls back to <c>"0.0.0-dev"</c> when the attribute is absent or empty.
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

        return string.IsNullOrEmpty(raw) ? Fallback : raw;
    }
}
