using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for the discovery endpoints (FR-09) and the health
/// endpoint (SAD §7). Implements WBS MVP §3.2.4.
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class DiscoveryAndHealthTests : IDisposable
{
    private readonly HttpClient _read;
    private readonly HttpClient _write;

    public DiscoveryAndHealthTests()
    {
        _read = TestEnvironment.CreateReadClient();
        _write = TestEnvironment.CreateWriteClient();
    }

    public void Dispose()
    {
        _read.Dispose();
        _write.Dispose();
    }

    [Fact]
    public async Task GetEnvironments_ContainsAllSeededEnvironments()
    {
        var envs = await _read.GetFromJsonAsync<string[]>("/api/environments");
        Assert.NotNull(envs);
        Assert.Contains("dev", envs!);
        Assert.Contains("qa", envs);
        Assert.Contains("uat", envs);
    }

    [Fact]
    public async Task GetServices_ContainsAllSeededServices()
    {
        var services = await _read.GetFromJsonAsync<string[]>("/api/services");
        Assert.NotNull(services);
        Assert.Contains("service-a", services!);
        Assert.Contains("service-b", services);
        Assert.Contains("service-c", services);
        Assert.Contains("service-d", services);
    }

    [Fact]
    public async Task GetEnvironments_IsAlphabeticallyOrdered()
    {
        var envs = (await _read.GetFromJsonAsync<string[]>("/api/environments"))!;
        var sorted = envs.OrderBy(e => e, System.StringComparer.Ordinal).ToArray();
        Assert.Equal(sorted, envs);
    }

    [Fact]
    public async Task GetHealth_ReadApi_Returns200WithStatusOk()
    {
        var resp = await _read.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("status", out var status));
        Assert.Equal("ok", status.GetString());
    }

    [Fact]
    public async Task GetHealth_WriteApi_Returns200WithStatusOk()
    {
        // /health on the Write API is unauthenticated by design — the
        // ApiKey middleware is only applied to /api/*. We use the
        // authenticated client because it shares the base URL.
        var resp = await _write.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("status", out var status));
        Assert.Equal("ok", status.GetString());
    }
}
