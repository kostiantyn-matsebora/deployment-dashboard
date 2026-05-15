using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests for <c>POST /api/deployments</c> on the running Write
/// API. Implements WBS MVP §3.2.1 of the architecture doc.
///
/// <para>Asserts the documented status codes from SAD §7 "API Contract":
/// 201 happy path, 401 missing/invalid key (FR-10), 422 invalid payload,
/// and append-only behaviour on duplicate POSTs (Decision §10 #6).</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class WriteApiTests : IDisposable
{
    private readonly HttpClient _authed;
    private readonly HttpClient _read;

    public WriteApiTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _read = TestEnvironment.CreateReadClient();
    }

    public void Dispose()
    {
        _authed.Dispose();
        _read.Dispose();
    }

    // ----------------------------------------------------------------- happy

    [Fact]
    public async Task Post_HappyPath_Returns201WithCreatedBody()
    {
        var payload = NewUniquePayload("ok");
        var resp = await _authed.PostAsJsonAsync("/api/deployments", payload, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        var body = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse>(DashboardJson.Options);
        Assert.NotNull(body);
        Assert.True(body!.Id > 0, "Server-assigned id must be positive.");
        Assert.Equal(payload.Service, body.Service);
        Assert.Equal(payload.Environment, body.Environment);
        Assert.Equal(payload.Version, body.Version);
        Assert.Equal(payload.Status, body.Status);
        Assert.Equal(payload.RunUrl, body.RunUrl);
        Assert.Equal(payload.RunNumber, body.RunNumber);
        Assert.Equal(payload.Actor, body.Actor);
        Assert.NotEqual(default, body.DeployedAt);
        Assert.Equal(DateTimeKind.Utc, body.DeployedAt.Kind);

        // Location header per REST conventions.
        Assert.NotNull(resp.Headers.Location);
    }

    // ----------------------------------------------------------------- 401

    [Fact]
    public async Task Post_MissingApiKey_Returns401()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        var payload = NewUniquePayload("noauth");
        var resp = await bare.PostAsJsonAsync("/api/deployments", payload, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(body.TryGetProperty("error", out var error), "401 body must contain 'error'.");
        Assert.False(string.IsNullOrWhiteSpace(error.GetString()));
    }

    [Fact]
    public async Task Post_WrongApiKey_Returns401()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        bare.DefaultRequestHeaders.Add("X-Api-Key", "obviously-wrong");
        var payload = NewUniquePayload("badkey");
        var resp = await bare.PostAsJsonAsync("/api/deployments", payload, DashboardJson.Options);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // ----------------------------------------------------------------- 422

    [Theory]
    [InlineData("missing-status")]
    [InlineData("unknown-status")]
    [InlineData("missing-service")]
    [InlineData("empty-version")]
    public async Task Post_InvalidPayload_Returns422(string variant)
    {
        // Build the raw JSON because the DTO disallows the very fields we
        // need to mutate — Data Annotations would reject before transport.
        var json = variant switch
        {
            "missing-status" => $$"""
                {
                  "service":     "qa-bot-fn-{{Guid.NewGuid():N}}",
                  "environment": "fn-test",
                  "version":     "v0.0.1",
                  "run_url":     "https://example.com/runs/1",
                  "run_number":  1,
                  "actor":       "qa.bot"
                }
                """,
            "unknown-status" => $$"""
                {
                  "service":     "qa-bot-fn-{{Guid.NewGuid():N}}",
                  "environment": "fn-test",
                  "version":     "v0.0.1",
                  "status":      "rolled-back",
                  "run_url":     "https://example.com/runs/1",
                  "run_number":  1,
                  "actor":       "qa.bot"
                }
                """,
            "missing-service" => """
                {
                  "environment": "fn-test",
                  "version":     "v0.0.1",
                  "status":      "success",
                  "run_url":     "https://example.com/runs/1",
                  "run_number":  1,
                  "actor":       "qa.bot"
                }
                """,
            "empty-version" => $$"""
                {
                  "service":     "qa-bot-fn-{{Guid.NewGuid():N}}",
                  "environment": "fn-test",
                  "version":     "",
                  "status":      "success",
                  "run_url":     "https://example.com/runs/1",
                  "run_number":  1,
                  "actor":       "qa.bot"
                }
                """,
            _ => throw new ArgumentOutOfRangeException(nameof(variant)),
        };

        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync("/api/deployments", content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // ----------------------------------------------------------------- duplicates / uniqueness

    [Fact]
    public async Task Post_SameDeploymentId_Returns409_OnSecond()
    {
        // SAD §7 "POST /api/deployments validation" - duplicate
        // (service, deployment_id) is rejected with 409 Conflict. The
        // matrix table is unique on that pair (SAD §5 "deployments table
        // Indexes"), so the second POST must NOT be persisted.
        var payload = NewUniquePayload("dup-same");

        var first = await _authed.PostAsJsonAsync("/api/deployments", payload, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await _authed.PostAsJsonAsync("/api/deployments", payload, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        // History should contain exactly one row - the duplicate was
        // rejected, not silently appended.
        var historyResp = await _read.GetAsync($"/api/deployments/{payload.Service}/{payload.Environment}/history");
        Assert.Equal(HttpStatusCode.OK, historyResp.StatusCode);
        var history = await historyResp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(history);
        Assert.Single(history!);
    }

    [Fact]
    public async Task Post_TwoDistinctDeploymentIds_BothSucceed_AndMatrixReflectsLatest()
    {
        // Two POSTs to the SAME (service, environment) slot, with
        // DISTINCT deployment_id values - both succeed and the matrix
        // surface reflects the latest. NewUniquePayload generates a
        // fresh deployment_id per call, so we pin service + environment
        // explicitly and let the rest vary.
        var serviceTag = $"dup-distinct-{Guid.NewGuid():N}".Substring(0, 24);
        var service = $"qa-bot-fn-{serviceTag}";
        const string environment = "fn-test";

        var firstPayload = new DeploymentEventRequest
        {
            DeploymentId = $"fn-distinct-a-{Guid.NewGuid():N}",
            Service = service,
            Environment = environment,
            Version = "v0.1.0",
            Status = "success",
            RunUrl = "https://example.com/runs/distinct-1",
            RunNumber = 1,
            Actor = "qa.bot",
        };
        var first = await _authed.PostAsJsonAsync("/api/deployments", firstPayload, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Tiny delay so server-side NOW() advances and "latest by
        // deployed_at" is deterministic across both inserts.
        await Task.Delay(50);

        var secondPayload = new DeploymentEventRequest
        {
            DeploymentId = $"fn-distinct-b-{Guid.NewGuid():N}",
            Service = service,
            Environment = environment,
            Version = "v0.2.0",
            Status = "success",
            RunUrl = "https://example.com/runs/distinct-2",
            RunNumber = 2,
            Actor = "qa.bot",
        };
        var second = await _authed.PostAsJsonAsync("/api/deployments", secondPayload, DashboardJson.Options);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);

        // History contains both rows in descending order.
        var historyResp = await _read.GetAsync($"/api/deployments/{service}/{environment}/history");
        Assert.Equal(HttpStatusCode.OK, historyResp.StatusCode);
        var history = await historyResp.Content.ReadFromJsonAsync<DeploymentEventResponse[]>(DashboardJson.Options);
        Assert.NotNull(history);
        Assert.True(history!.Length >= 2,
            $"Expected at least two rows for two distinct POSTs; got {history.Length}.");

        // Matrix reflects the latest (second) deployment.
        var slotResp = await _read.GetAsync($"/api/deployments/{service}/{environment}");
        Assert.Equal(HttpStatusCode.OK, slotResp.StatusCode);
        var slot = await slotResp.Content.ReadFromJsonAsync<MatrixSlot>(DashboardJson.Options);
        Assert.NotNull(slot);
        Assert.Equal(secondPayload.Version, slot!.Current.Version);
    }

    private static DeploymentEventRequest NewUniquePayload(string tag) => new()
    {
        // Suffix keeps every run isolated from prior runs without breaking
        // seed-based assertions in the matrix tests.
        // 'deployment_id' is REQUIRED per SAD §7 "POST /api/deployments
        // request body" (Phase 2) — a unique value per call keeps duplicate-
        // related 409 paths off the happy-path test.
        DeploymentId = $"fn-{tag}-{Guid.NewGuid():N}",
        Service = $"qa-bot-fn-{tag}-{Guid.NewGuid():N}".Substring(0, 32),
        Environment = "fn-test",
        Version = $"v0.0.{DateTime.UtcNow.Ticks % 1_000_000}",
        Status = "success",
        RunUrl = "https://example.com/runs/fn",
        RunNumber = 99_000,
        Actor = "qa.bot",
    };
}
