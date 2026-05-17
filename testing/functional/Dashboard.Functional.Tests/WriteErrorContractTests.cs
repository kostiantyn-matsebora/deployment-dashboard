using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Phase 5 targeted regression for CR-0008 — RFC 7807 ProblemDetails (the
/// plain variant, no <c>errors</c> map) for the non-validation Write 4xx:
///
/// <list type="bullet">
///   <item><c>409 Conflict</c> on duplicate <c>(service, deployment_id)</c>
///         — body must be <c>application/problem+json</c> with the legacy
///         error slug preserved as a top-level extension member named
///         <c>error</c> (CR-0008 § "Standardised error response shape").
///         </item>
///   <item><c>401 Unauthorized</c> on missing / invalid <c>X-Api-Key</c> —
///         body must be <c>application/problem+json</c>. The legacy
///         <c>{"error":"..."}</c> JSON contract is superseded; bare JSON
///         is a regression.</item>
/// </list>
///
/// <para>TIGHT oracles: each test checks Content-Type, the absence of
/// the <c>errors</c> map (distinguishing plain ProblemDetails from
/// ValidationProblemDetails), and the top-level <c>error</c> slug for
/// machine-readable continuity with pre-CR-0008 clients.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class WriteErrorContractTests : IDisposable
{
    private readonly HttpClient _authed;
    private readonly string _runScope;

    public WriteErrorContractTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _runScope = Guid.NewGuid().ToString("N")[..12];
    }

    public void Dispose() => _authed.Dispose();

    // --------------------------------------------------------- Case #6

    [Fact]
    public async Task Post_DuplicateDeploymentId_Returns409_AsProblemJsonWithErrorSlug()
    {
        var service = $"qa-bot-fn-dup-shape-{_runScope}";
        var depId = $"dup-shape-{_runScope}";
        var payload = new
        {
            deployment_id = depId,
            service,
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/dup-shape",
            run_number = 1,
            actor = "qa.bot",
        };

        var first = await _authed.PostAsJsonAsync("/api/deployments", payload);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await _authed.PostAsJsonAsync("/api/deployments", payload);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        // CR-0008: 409 body shape = ProblemDetails (plain, no 'errors' map).
        Assert.Equal("application/problem+json", second.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await second.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("type", out var typeEl) && typeEl.ValueKind == JsonValueKind.String);
        Assert.True(root.TryGetProperty("title", out _));
        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 409);

        // Plain ProblemDetails — must NOT have an 'errors' map (that's
        // the ValidationProblemDetails discriminator).
        Assert.False(root.TryGetProperty("errors", out _),
            "409 body must NOT carry an 'errors' map — that is ValidationProblemDetails territory.");

        // Legacy slug preserved as a top-level extension member per
        // CR-0008 § "Standardised error response shape" — machine-readable
        // continuity with pre-CR-0008 clients.
        Assert.True(root.TryGetProperty("error", out var errorSlug) && errorSlug.ValueKind == JsonValueKind.String,
            "409 ProblemDetails MUST preserve the legacy error slug at top level as 'error' (extensions['error']).");
        Assert.False(string.IsNullOrWhiteSpace(errorSlug.GetString()));
    }

    // --------------------------------------------------------- Case #7

    [Fact]
    public async Task Post_MissingApiKey_Returns401_AsProblemJson()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        var payload = new
        {
            deployment_id = $"fn-401-{_runScope}-{Guid.NewGuid():N}",
            service = $"qa-bot-fn-401-{_runScope}",
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/401",
            run_number = 1,
            actor = "qa.bot",
        };
        var resp = await bare.PostAsJsonAsync("/api/deployments", payload);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);

        // CR-0008 §3c is explicit: "Existing HTTP status codes from
        // CR-0003 / CR-0004 / SAD §7 are preserved unchanged (400, 401,
        // 409, 422); only the response body shape is standardised."
        // Per Decision 6 in CR-0008: ProblemDetails applies across the
        // whole API surface. So 401 MUST be problem+json — NOT
        // text/plain, NOT application/json, NOT empty.
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var root = doc.RootElement;

        Assert.True(root.TryGetProperty("status", out var statusEl) && statusEl.GetInt32() == 401);
        Assert.True(root.TryGetProperty("title", out _));
        // Plain ProblemDetails for 401 — no 'errors' map.
        Assert.False(root.TryGetProperty("errors", out _),
            "401 body must NOT carry an 'errors' map.");
    }

    [Fact]
    public async Task Post_WrongApiKey_Returns401_AsProblemJson()
    {
        using var bare = TestEnvironment.CreateUnauthenticatedWriteClient();
        bare.DefaultRequestHeaders.Add("X-Api-Key", "definitely-wrong-key");
        var payload = new
        {
            deployment_id = $"fn-401b-{_runScope}-{Guid.NewGuid():N}",
            service = $"qa-bot-fn-401b-{_runScope}",
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/401b",
            run_number = 1,
            actor = "qa.bot",
        };
        var resp = await bare.PostAsJsonAsync("/api/deployments", payload);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
    }
}
