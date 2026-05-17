using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Security;
using Microsoft.Extensions.DependencyInjection;

namespace Dashboard.WriteApi.Tests;

public sealed class DeploymentsEndpointTests : IClassFixture<TestApplicationFactory>
{
    private readonly TestApplicationFactory _factory;
    private readonly HttpClient _client;

    public DeploymentsEndpointTests(TestApplicationFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private static int _idSeed;

    private static DeploymentEventRequest ValidPayload(string? deploymentId = null) => new()
    {
        DeploymentId = deploymentId ?? $"gh-run-{Interlocked.Increment(ref _idSeed)}",
        Service = "web-portal",
        Environment = "dev",
        Version = "v2.3.1",
        Status = "success",
        RunUrl = "https://github.com/org/repo/actions/runs/1247",
        RunNumber = 1247,
        Actor = "john.doe",
    };

    /// <summary>
    /// Four ingest-acceptance cases per FR-05 + SAD §7 POST body table.
    /// Returned as (description, json-body-fragment, expected-stored-ref,
    /// expected-stored-sha). The fragment is concatenated into a 7-field
    /// base so the absence vs explicit-null distinction is preserved on the
    /// wire (omit-the-property vs send "ref": null) — both must be accepted
    /// and both must materialise as null in storage.
    /// </summary>
    public static IEnumerable<object?[]> IngestAcceptanceCases() => new[]
    {
        new object?[] { "neither",   string.Empty,                                                                                (string?)null,             (string?)null },
        new object?[] { "ref-only",  ",\"ref\":\"feature/login-revamp\"",                                                            "feature/login-revamp",    (string?)null },
        new object?[] { "sha-only",  ",\"sha\":\"9f1c0d2e8a\"",                                                                      (string?)null,             "9f1c0d2e8a" },
        new object?[] { "both",      ",\"ref\":\"feature/login-revamp\",\"sha\":\"9f1c0d2e8a\"",                                     "feature/login-revamp",    "9f1c0d2e8a" },
        new object?[] { "explicit-null-both", ",\"ref\":null,\"sha\":null",                                                          (string?)null,             (string?)null },
    };

    private HttpRequestMessage WithApiKey(HttpRequestMessage req)
    {
        req.Headers.Add(ApiKeyMiddleware.HeaderName, _factory.ApiKey);
        return req;
    }

    [Fact]
    public async Task Post_Deployments_HappyPath_Returns201WithCreatedBody()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(), options: DashboardJson.Options),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<DeploymentEventResponse>(DashboardJson.Options);
        Assert.NotNull(body);
        Assert.True(body!.Id > 0);
        Assert.Equal("web-portal", body.Service);
        Assert.Equal("dev", body.Environment);
        Assert.Equal("success", body.Status);
        // NOTIFY dispatch must have been invoked once.
        Assert.Contains(_factory.Notifier.Published, p => p.Id == body.Id);
    }

    [Fact]
    public async Task Post_Deployments_InvalidPayload_Returns422()
    {
        var bad = ValidPayload() with { Status = "rolled-back" };
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(bad, options: DashboardJson.Options),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    [Fact]
    public async Task Post_Deployments_MissingApiKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(), options: DashboardJson.Options),
        };
        // intentionally no X-Api-Key header
        var resp = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Post_Deployments_WrongApiKey_Returns401()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(), options: DashboardJson.Options),
        };
        req.Headers.Add(ApiKeyMiddleware.HeaderName, "obviously-wrong");
        var resp = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task Post_Deployments_AcceptsKebabSnakeCasePayloadKeys()
    {
        // Belt-and-braces: send raw JSON with the snake_case keys the SAD
        // documents to prove the binder accepts the wire shape.
        var raw = """
        {
          "deployment_id":   "gh-run-snake-1216",
          "service":         "auth-service",
          "environment":     "qa",
          "version":         "v1.7.8",
          "status":          "success",
          "run_url":         "https://github.com/org/repo/actions/runs/1216",
          "run_number":      1216,
          "actor":           "alice.johnson"
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>(DashboardJson.Options);
        Assert.Equal("auth-service", body.GetProperty("service").GetString());
        Assert.Equal("https://github.com/org/repo/actions/runs/1216", body.GetProperty("run_url").GetString());
        Assert.Equal(1216, body.GetProperty("run_number").GetInt64());
    }

    [Fact]
    public async Task Post_Deployments_DistinctIds_AppendIndependentRows()
    {
        // SAD §7 REST constraints: writes are append-only on
        // (service, deployment_id). Two POSTs with DIFFERENT
        // deployment_id values both succeed and both create rows.
        async Task<DeploymentEventResponse> Post(string id)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
            {
                Content = JsonContent.Create(ValidPayload(id), options: DashboardJson.Options),
            };
            var resp = await _client.SendAsync(WithApiKey(req));
            Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
            return (await resp.Content.ReadFromJsonAsync<DeploymentEventResponse>(DashboardJson.Options))!;
        }

        var first = await Post("gh-run-aaa");
        var second = await Post("gh-run-bbb");

        Assert.NotEqual(first.Id, second.Id);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var rows = db.Deployments.Where(d => d.Service == "web-portal" && d.Environment == "dev").Count();
        Assert.True(rows >= 2);
    }

    [Theory]
    [MemberData(nameof(IngestAcceptanceCases))]
    public async Task Post_Deployments_AcceptsAllFourRefShaCases_AndPersistsVerbatim(
        string caseName,
        string optionalFieldsFragment,
        string? expectedRef,
        string? expectedSha)
    {
        // FR-05 + SAD §7 POST body: ref and sha are independently optional.
        // The deserialiser MUST accept absent, null, and string values for
        // each. Persisted values must be verbatim — no trimming, no length
        // truncation, no format check (SAD §10 Decision 10).
        _ = caseName; // descriptive only — surfaced by xUnit test display name.

        var deploymentId = $"gh-acceptance-{Interlocked.Increment(ref _idSeed)}";
        var raw = $$"""
        {
          "deployment_id":   "{{deploymentId}}",
          "service":         "web-portal",
          "environment":     "dev",
          "version":         "v2.3.1",
          "status":          "success",
          "run_url":         "https://github.com/org/repo/actions/runs/1247",
          "run_number":      1247,
          "actor":           "john.doe"{{optionalFieldsFragment}}
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        // Response body carries the stored values (always-emit convention —
        // ref/sha keys present, null when stored value is null).
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>(DashboardJson.Options);
        Assert.Equal(deploymentId, body.GetProperty("deployment_id").GetString());

        Assert.True(body.TryGetProperty("ref", out var refProp), "response missing 'ref'");
        Assert.True(body.TryGetProperty("sha", out var shaProp), "response missing 'sha'");
        if (expectedRef is null) Assert.Equal(JsonValueKind.Null, refProp.ValueKind);
        else Assert.Equal(expectedRef, refProp.GetString());
        if (expectedSha is null) Assert.Equal(JsonValueKind.Null, shaProp.ValueKind);
        else Assert.Equal(expectedSha, shaProp.GetString());

        // Round-trip through the DB to prove persistence — not just echo.
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var stored = db.Deployments.Single(d => d.DeploymentId == deploymentId);
        Assert.Equal(expectedRef, stored.Ref);
        Assert.Equal(expectedSha, stored.Sha);
    }

    [Fact]
    public async Task Post_Deployments_RefAndSha_PersistedVerbatim_NoTrimming()
    {
        // CR-0008 (closes CR-0004 § Decision 10): caps now exist (ref: 200,
        // sha: 64) but persistence is still verbatim WITHIN those caps — no
        // trimming, no truncation, no format check. Surrounding whitespace
        // is preserved because the value (with whitespace) is still
        // non-whitespace-empty and within cap.
        var deploymentId = $"gh-verbatim-{Interlocked.Increment(ref _idSeed)}";
        var paddedRef = "  feature/login-revamp  ";        // 24 chars, ≤ 200 cap
        var maxLengthSha = new string('a', 64);             // exactly at cap
        var raw = $$"""
        {
          "deployment_id":   "{{deploymentId}}",
          "service":         "web-portal",
          "environment":     "dev",
          "version":         "v2.3.1",
          "status":          "success",
          "run_url":         "https://github.com/org/repo/actions/runs/1247",
          "run_number":      1247,
          "actor":           "john.doe",
          "ref":             "{{paddedRef}}",
          "sha":             "{{maxLengthSha}}"
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
        var stored = db.Deployments.Single(d => d.DeploymentId == deploymentId);
        Assert.Equal(paddedRef, stored.Ref);
        Assert.Equal(maxLengthSha, stored.Sha);
    }

    [Fact]
    public async Task Post_Deployments_ShaOverCap_Returns422_WithProblemDetails()
    {
        // CR-0008 § Standardised error response + Decision 2: sha cap is 64.
        // Wire violation must return 422 with ValidationProblemDetails;
        // `errors` map keyed by camelCase JSON field name (`sha`).
        var deploymentId = $"gh-sha-over-cap-{Interlocked.Increment(ref _idSeed)}";
        var raw = $$"""
        {
          "deployment_id":   "{{deploymentId}}",
          "service":         "web-portal",
          "environment":     "dev",
          "version":         "v2.3.1",
          "status":          "success",
          "run_url":         "https://github.com/org/repo/actions/runs/1247",
          "run_number":      1247,
          "actor":           "john.doe",
          "sha":             "{{new string('a', 65)}}"
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        Assert.Equal("application/problem+json",
            resp.Content.Headers.ContentType?.MediaType);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(422, body.GetProperty("status").GetInt32());
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("sha", out _),
            $"expected camelCase 'sha' error key, got: {string.Join(",", errors.EnumerateObject().Select(p => p.Name))}");
    }

    [Fact]
    public async Task Post_Deployments_ParentDeploymentsBadElement_Returns422_WithIndexedMessages()
    {
        // CR-0008 row `parent_deployments[i]`: per-element messages land in
        // the `parentDeployments` error key with the element index in the
        // message (per Decision: "parentDeployments[0]" / "[2]" form).
        var deploymentId = $"gh-bad-parents-{Interlocked.Increment(ref _idSeed)}";
        var tooLong = new string('p', 201);
        var raw = $$"""
        {
          "deployment_id":   "{{deploymentId}}",
          "service":         "web-portal",
          "environment":     "dev",
          "version":         "v2.3.1",
          "status":          "success",
          "run_url":         "https://github.com/org/repo/actions/runs/1247",
          "run_number":      1247,
          "actor":           "john.doe",
          "parent_deployments": ["ok-parent", "{{tooLong}}"]
        }
        """;

        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = new StringContent(raw, Encoding.UTF8, "application/json"),
        };
        var resp = await _client.SendAsync(WithApiKey(req));

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var errors = body.GetProperty("errors");
        Assert.True(errors.TryGetProperty("parentDeployments", out var pdErrors));
        var messages = pdErrors.EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Contains(messages, m => m is not null && m.Contains("[1]") && m.Contains("200"));
    }

    [Fact]
    public async Task Post_Deployments_MissingApiKey_Returns401_WithProblemJsonBody()
    {
        // CR-0008 Decision 6: 401 body is also application/problem+json. The
        // existing `error` slug is preserved as an extension entry.
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/deployments")
        {
            Content = JsonContent.Create(ValidPayload(), options: DashboardJson.Options),
        };
        var resp = await _client.SendAsync(req);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        Assert.Equal("application/problem+json",
            resp.Content.Headers.ContentType?.MediaType);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(401, body.GetProperty("status").GetInt32());
    }

    [Fact]
    public async Task Get_Health_Returns200_WithDbPing()
    {
        var resp = await _client.GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("ok", body.GetProperty("status").GetString());
    }
}
