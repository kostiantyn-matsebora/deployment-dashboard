using System.Net.Http.Json;
using Dashboard.Shared.Contracts;

namespace Dashboard.Fetcher.Ingest;

/// <summary>
/// HTTP client for POST /api/deployments (F1).
/// X-Api-Key is added by the typed-client factory in DI.
/// </summary>
public sealed class IngestClient(HttpClient http) : IIngestClient
{
    public async Task PostAsync(DeploymentEventIngest ev, string adapterId, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ev)
        };
        request.Headers.Add("X-Progress-Reporter", $"dashboard-fetcher/{adapterId}");

        var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
    }
}
