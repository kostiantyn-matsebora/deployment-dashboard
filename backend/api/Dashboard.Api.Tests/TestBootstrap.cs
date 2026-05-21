using System.Runtime.CompilerServices;

namespace Dashboard.Api.Tests;

/// <summary>
/// Assembly-wide bootstrap. Pins the <c>API_TOKEN</c> the
/// <see cref="Dashboard.Api.Program"/> host reads at build time, so
/// xunit's class-level parallelism cannot race a per-test factory's
/// <c>Environment.SetEnvironmentVariable("API_TOKEN", …)</c> against
/// another class's WebApplicationFactory startup. Mirrors the bootstrap
/// in <c>Dashboard.ReadApi.Tests.TestBootstrap</c>.
/// </summary>
internal static class TestBootstrap
{
    public const string ApiKey = "test-key";

    [ModuleInitializer]
    public static void Init()
    {
        Environment.SetEnvironmentVariable("API_TOKEN", ApiKey);
    }
}
