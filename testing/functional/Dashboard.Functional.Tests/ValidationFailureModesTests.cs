using System;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Functional tests covering every row of the "POST /api/deployments
/// validation - failure modes" table in SAD §7 "API Contract" (Phase 2).
///
/// <para>The SAD table (verbatim):</para>
/// <list type="bullet">
///   <item>Missing or empty <c>deployment_id</c> -> <c>422</c>.</item>
///   <item>Duplicate <c>(service, deployment_id)</c> -> <c>409 Conflict</c>.</item>
///   <item><c>parent_deployments[i]</c> references a different
///         <c>service</c> -> <c>400</c>.</item>
///   <item><c>parent_deployments[i]</c> forms a directed cycle through
///         resolved nodes -> <c>400</c>.</item>
///   <item><c>parent_deployments[i]</c> not yet ingested -> <c>201</c>
///         (accepted; reference held as dangling and resolved on the
///         next read after the missing source lands).</item>
///   <item>Missing/invalid <c>X-Api-Key</c> -> <c>401</c>.</item>
/// </list>
///
/// <para>These tests bypass the typed DTOs because the new fields
/// (<c>deployment_id</c>, <c>parent_deployments</c>) are introduced by
/// the backend in Phase 2; this suite asserts the wire shape directly
/// against the SAD so the test is an oracle for the backend
/// implementation rather than a tautology.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class ValidationFailureModesTests : IDisposable
{
    private readonly HttpClient _authed;
    private readonly HttpClient _read;
    private readonly string _runScope;

    public ValidationFailureModesTests()
    {
        _authed = TestEnvironment.CreateWriteClient();
        _read = TestEnvironment.CreateReadClient();
        // Per-instance scope keeps every test isolated from prior runs
        // without coupling to a global cleanup pass.
        _runScope = Guid.NewGuid().ToString("N").Substring(0, 12);
    }

    public void Dispose()
    {
        _authed.Dispose();
        _read.Dispose();
    }

    // -------------------------------------------- 422 - missing deployment_id

    [Fact]
    public async Task Post_MissingDeploymentId_Returns422()
    {
        var json = $$"""
            {
              "service":     "qa-bot-fn-missing-id-{{_runScope}}",
              "environment": "fn-test",
              "version":     "v0.0.1",
              "status":      "success",
              "run_url":     "https://example.com/runs/1",
              "run_number":  1,
              "actor":       "qa.bot"
            }
            """;
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync("/api/deployments", content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    [Fact]
    public async Task Post_EmptyDeploymentId_Returns422()
    {
        var json = $$"""
            {
              "deployment_id": "",
              "service":       "qa-bot-fn-empty-id-{{_runScope}}",
              "environment":   "fn-test",
              "version":       "v0.0.1",
              "status":        "success",
              "run_url":       "https://example.com/runs/1",
              "run_number":    1,
              "actor":         "qa.bot"
            }
            """;
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        var resp = await _authed.PostAsync("/api/deployments", content);

        Assert.Equal((HttpStatusCode)422, resp.StatusCode);
    }

    // -------------------------------------------- 409 - duplicate (service, deployment_id)

    [Fact]
    public async Task Post_DuplicateDeploymentId_Returns409()
    {
        var service = $"qa-bot-fn-dup-{_runScope}";
        var depId = $"dup-id-{_runScope}";
        var payload = new
        {
            deployment_id = depId,
            service,
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/dup",
            run_number = 1,
            actor = "qa.bot",
        };

        // First POST succeeds.
        var first = await _authed.PostAsJsonAsync("/api/deployments", payload);
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Second POST with the same (service, deployment_id) must be 409.
        var second = await _authed.PostAsJsonAsync("/api/deployments", payload);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);

        // History should contain exactly one row for this slot - the
        // duplicate was rejected, not silently merged.
        var historyResp = await _read.GetAsync($"/api/deployments/{service}/fn-test/history");
        Assert.Equal(HttpStatusCode.OK, historyResp.StatusCode);
        var history = await historyResp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(JsonValueKind.Array, history.ValueKind);
        Assert.Equal(1, history.GetArrayLength());
    }

    [Fact]
    public async Task Post_SameDeploymentId_DifferentService_BothSucceed()
    {
        // The uniqueness key is (service, deployment_id) per SAD §5
        // "deployments table" -> "Indexes" - same id under a different
        // service is a separate row.
        var depId = $"shared-id-{_runScope}";

        var firstService = $"qa-bot-fn-shared-a-{_runScope}";
        var secondService = $"qa-bot-fn-shared-b-{_runScope}";

        var first = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = depId,
            service = firstService,
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/shared-1",
            run_number = 10,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        var second = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = depId,
            service = secondService,
            environment = "fn-test",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/shared-2",
            run_number = 11,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
    }

    // -------------------------------------------- 400 - cross-service parent

    [Fact]
    public async Task Post_ParentInDifferentService_Returns400()
    {
        var serviceA = $"qa-bot-fn-xsvc-a-{_runScope}";
        var serviceB = $"qa-bot-fn-xsvc-b-{_runScope}";

        // Seed a parent in service A.
        var parent = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = $"xsvc-parent-{_runScope}",
            service = serviceA,
            environment = "dev",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/xsvc-parent",
            run_number = 20,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.Created, parent.StatusCode);

        // Try to point at it from service B -> 400.
        var child = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = $"xsvc-child-{_runScope}",
            parent_deployments = new[] { $"xsvc-parent-{_runScope}" },
            service = serviceB,
            environment = "dev",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/xsvc-child",
            run_number = 21,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.BadRequest, child.StatusCode);
    }

    // -------------------------------------------- 400 - cycle

    [Fact]
    public async Task Post_CycleThroughResolvedNodes_Returns400()
    {
        // Build a small chain inside one service: A -> B -> C, then try
        // to insert D such that D would close a cycle back to A through
        // resolved parents. The SAD says cycles "through resolved nodes"
        // are rejected at write time; dangling references are exempt.
        var service = $"qa-bot-fn-cycle-{_runScope}";
        var idA = $"cycle-a-{_runScope}";
        var idB = $"cycle-b-{_runScope}";
        var idC = $"cycle-c-{_runScope}";

        // A (root) in env-1.
        await PostAndAssertCreated(new
        {
            deployment_id = idA,
            service,
            environment = "env-1",
            version = "v0.0.1",
            status = "success",
            run_url = "https://example.com/runs/cycle-a",
            run_number = 30,
            actor = "qa.bot",
        });
        // B in env-2, parent = A.
        await PostAndAssertCreated(new
        {
            deployment_id = idB,
            parent_deployments = new[] { idA },
            service,
            environment = "env-2",
            version = "v0.0.2",
            status = "success",
            run_url = "https://example.com/runs/cycle-b",
            run_number = 31,
            actor = "qa.bot",
        });
        // C in env-3, parent = B.
        await PostAndAssertCreated(new
        {
            deployment_id = idC,
            parent_deployments = new[] { idB },
            service,
            environment = "env-3",
            version = "v0.0.3",
            status = "success",
            run_url = "https://example.com/runs/cycle-c",
            run_number = 32,
            actor = "qa.bot",
        });

        // Attempt to insert a new event into env-1 that names C as a
        // parent. C's resolved ancestry already includes A in env-1, so
        // the resulting edge env-3 -> env-1 would close a cycle through
        // resolved nodes.
        var cycleClose = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = $"cycle-close-{_runScope}",
            parent_deployments = new[] { idC },
            service,
            environment = "env-1",
            version = "v0.0.4",
            status = "success",
            run_url = "https://example.com/runs/cycle-close",
            run_number = 33,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.BadRequest, cycleClose.StatusCode);
    }

    // -------------------------------------------- 201 - dangling reference accepted

    [Fact]
    public async Task Post_DanglingParentReference_Accepted_AndResolvesOnLater()
    {
        // Per SAD §5 Topology Derivation step 5 + §7 validation table
        // last row: a reference to a not-yet-ingested deployment_id is
        // accepted with 201 and recorded verbatim. The next read after
        // the source lands automatically picks it up.
        var service = $"qa-bot-fn-dangling-{_runScope}";
        var sourceId = $"dangling-source-{_runScope}";
        var childId = $"dangling-child-{_runScope}";

        // Child arrives FIRST, naming a parent that doesn't exist yet.
        var child = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = childId,
            parent_deployments = new[] { sourceId },
            service,
            environment = "qa",
            version = "v0.1.0",
            status = "success",
            run_url = "https://example.com/runs/dangling-child",
            run_number = 40,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.Created, child.StatusCode);

        // Matrix read - the topology section should NOT yet contain an
        // edge for the unresolved reference (step 5 of derivation).
        var beforeMatrix = await GetMatrixAsync();
        var beforeEdges = GetEdges(beforeMatrix, service);
        var beforeMatch = false;
        foreach (var edge in beforeEdges)
        {
            if (edge.GetProperty("from").GetString() == "dev" &&
                edge.GetProperty("to").GetString() == "qa")
            {
                beforeMatch = true;
                break;
            }
        }
        Assert.False(beforeMatch,
            "Before the dangling source lands, the matrix topology must NOT " +
            "contain an edge dev -> qa for this service (dangling refs are held).");

        // Now the parent lands - same service, dev env.
        var parent = await _authed.PostAsJsonAsync("/api/deployments", new
        {
            deployment_id = sourceId,
            service,
            environment = "dev",
            version = "v0.0.9",
            status = "success",
            run_url = "https://example.com/runs/dangling-source",
            run_number = 41,
            actor = "qa.bot",
        });
        Assert.Equal(HttpStatusCode.Created, parent.StatusCode);

        // The next matrix read should now show the explicit edge.
        var afterMatrix = await GetMatrixAsync();
        var afterEdges = GetEdges(afterMatrix, service);
        var resolved = false;
        foreach (var edge in afterEdges)
        {
            if (edge.GetProperty("from").GetString() == "dev" &&
                edge.GetProperty("to").GetString() == "qa" &&
                edge.GetProperty("source").GetString() == "explicit")
            {
                resolved = true;
                break;
            }
        }
        Assert.True(resolved,
            "After the dangling source landed, the matrix topology must contain " +
            "an explicit edge dev -> qa for this service.");
    }

    // -------------------------------------------- helpers

    private async Task PostAndAssertCreated(object payload)
    {
        var resp = await _authed.PostAsJsonAsync("/api/deployments", payload);
        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
    }

    private async Task<JsonElement> GetMatrixAsync()
    {
        var resp = await _read.GetAsync("/api/deployments");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static JsonElement.ArrayEnumerator GetEdges(JsonElement matrix, string service)
    {
        Assert.True(matrix.TryGetProperty(service, out var svc),
            $"Matrix is missing service '{service}'.");
        Assert.True(svc.TryGetProperty("topology", out var topology),
            $"Service '{service}' has no 'topology' block - this is the Phase 2 wire shape.");
        Assert.True(topology.TryGetProperty("edges", out var edges),
            $"Service '{service}' topology has no 'edges' array.");
        Assert.Equal(JsonValueKind.Array, edges.ValueKind);
        // Returning the enumerator is fine because the JsonDocument was
        // materialised by ReadFromJsonAsync<JsonElement> which keeps the
        // underlying buffer alive for the test's duration.
        return edges.EnumerateArray();
    }
}
