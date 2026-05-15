using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Threading.Tasks;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the per-slot history endpoint
/// <c>GET /api/deployments/{service}/{environment}/history</c>.
///
/// <para>Implements WBS MVP §3.2.3.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class HistoryApiTests : IDisposable
{
    private readonly HttpClient _read;

    public HistoryApiTests()
    {
        _read = TestEnvironment.CreateReadClient();
    }

    public void Dispose() => _read.Dispose();

    [Fact]
    public async Task History_KnownSlot_Returns200AndDescendingOrder()
    {
        // service-c/dev has 3 seeded events: success v3.1.0, failure v3.1.1,
        // in-progress v3.1.2. They should come back newest-first.
        var resp = await _read.GetAsync("/api/deployments/service-c/dev/history");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var events = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(events);
        Assert.True(events!.Length >= 3,
            $"Expected ≥3 history rows for service-c/dev; got {events.Length}.");

        // Newest first.
        var deployedAt = events.Select(e => e.DeployedAt).ToArray();
        for (var i = 1; i < deployedAt.Length; i++)
        {
            Assert.True(deployedAt[i - 1] >= deployedAt[i],
                $"History row {i - 1} ({deployedAt[i - 1]:o}) should be ≥ row {i} ({deployedAt[i]:o}).");
        }

        // The most recent row must be the latest seeded version.
        Assert.Equal("v3.1.2", events[0].Version);
        Assert.Equal("in-progress", events[0].Status);
    }

    [Fact]
    public async Task History_UnknownSlot_Returns404()
    {
        var resp = await _read.GetAsync("/api/deployments/no-such-service-xyz/no-such-env-zzz/history");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task History_RespectsLimitQueryParameter()
    {
        // Limit smaller than the seeded count returns exactly that many rows.
        var resp = await _read.GetAsync("/api/deployments/service-c/dev/history?limit=1");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var events = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(events);
        Assert.Single(events!);
    }

    [Fact]
    public async Task History_DefaultLimitIsAtMost50()
    {
        // SAD §7 documents the default as 50. We don't seed enough rows to
        // measure the literal default, so we assert the boundary: omitting
        // ?limit must never return more than 50 events.
        var resp = await _read.GetAsync("/api/deployments/service-c/dev/history");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var events = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(events);
        Assert.True(events!.Length <= 50,
            $"Default history limit should be ≤ 50; got {events.Length}.");
    }
}
