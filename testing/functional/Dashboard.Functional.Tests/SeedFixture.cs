using System;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Assembly-wide xUnit fixture that asserts the target stack already
/// contains the canonical six-state fixture corpus before tests run. The
/// fixture is a **precondition check**, not a side effect — seeding is the
/// developer's responsibility (invoke
/// <c>pwsh -NoProfile -File testing/scripts/seed.ps1</c> once before
/// running the suite). This keeps SeedFixture purely a guard and avoids
/// coupling test execution to the seed script's parameter surface.
///
/// <para>CI and local runners may set <c>DASHBOARD_SKIP_SEED=1</c> to
/// bypass the check entirely (e.g. when running a filter that targets
/// endpoints unaffected by the matrix corpus, like <c>/health</c>).</para>
/// </summary>
public sealed class SeedFixture : IAsyncLifetime
{
    private const string SeedHint =
        "Database appears empty — run 'pwsh -NoProfile -File testing/scripts/seed.ps1' before invoking the functional suite.";

    public async Task InitializeAsync()
    {
        if (Environment.GetEnvironmentVariable("DASHBOARD_SKIP_SEED") == "1")
        {
            return;
        }

        using var client = TestEnvironment.CreateReadClient();

        HttpResponseMessage response;
        try
        {
            response = await client.GetAsync("/api/services");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Could not reach Read API at {TestEnvironment.ReadBaseUrl}/api/services to verify seed corpus. {SeedHint}",
                ex);
        }

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"GET /api/services returned {(int)response.StatusCode} — cannot verify seed corpus. {SeedHint}");
        }

        var services = await response.Content.ReadFromJsonAsync<JsonElement>();
        if (services.ValueKind != JsonValueKind.Array || services.GetArrayLength() == 0)
        {
            throw new InvalidOperationException(SeedHint);
        }
    }

    public Task DisposeAsync() => Task.CompletedTask;
}

/// <summary>
/// Collection definition lets all functional test classes share the
/// single precondition check per assembly run.
/// </summary>
[CollectionDefinition(nameof(SeedCollection))]
public sealed class SeedCollection : ICollectionFixture<SeedFixture>
{
}
