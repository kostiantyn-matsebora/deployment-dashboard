using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Validates that the FR-05 / SAD §10 Decision #10 source-identifier
/// fields (<c>ref</c> and <c>sha</c>) arrive on the SSE
/// <c>slot-update</c> event when they were present on the ingested
/// payload.
///
/// <para>Citations: SAD §7 "SSE slot-update data payload" (line 910 —
/// "<c>ref</c> and <c>sha</c> follow the same omitted-or-<c>null</c>-
/// when-absent rule as on the matrix response"); SAD §7 "Matrix
/// response shape — per service" field rules (lines 886-892); SAD §10
/// Decision #10 ("additive-only; no validation in this cycle").</para>
///
/// <para>How the assertion is performed (mirrors
/// <see cref="SseTopologyAbsenceTests"/>): open <c>GET /api/stream</c>
/// BEFORE the write to avoid racing the event into the void, POST a
/// fresh event whose payload carries <c>ref</c> + <c>sha</c>, then read
/// the next SSE <c>data:</c> frame matching our (service, environment)
/// within the NFR-03 5 s budget. Parse the data line as JSON and
/// assert the omit-or-null tolerance for both fields.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class SseRefShaTests
{
    private static readonly TimeSpan EventBudget = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task SseDataFrame_Carries_RefAndSha_WhenIngested()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        // 1. Subscribe to the SSE stream BEFORE writing.
        using var streamClient = new HttpClient { BaseAddress = new Uri(TestEnvironment.ReadBaseUrl) };
        streamClient.Timeout = Timeout.InfiniteTimeSpan;
        using var streamReq = new HttpRequestMessage(HttpMethod.Get, "/api/stream");
        streamReq.Headers.Accept.Clear();
        streamReq.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var streamResp = await streamClient.SendAsync(streamReq, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, streamResp.StatusCode);

        using var body = await streamResp.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(body, Encoding.UTF8);

        // 2. POST a fresh event with BOTH ref and sha. Unique service /
        // deployment_id to avoid colliding with prior runs or other tests.
        var suffix = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}";
        var service = $"qa-bot-sse-refsha-{suffix[..16]}";
        var deploymentId = $"sse-refsha-{suffix}";
        const string env = "fn-sse-refsha";
        const string expectedRef = "feature/sse-refsha";
        const string expectedSha = "9f1c0d2e8a";

        using var writeClient = TestEnvironment.CreateWriteClient();
        var post = await writeClient.PostAsync("/api/deployments", new StringContent(
            $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{env}}",
              "version":       "v0.0.{{DateTime.UtcNow.Ticks % 1_000_000}}",
              "status":        "success",
              "run_url":       "https://example.com/runs/sse-refsha",
              "run_number":    99970,
              "actor":         "qa.bot",
              "ref":           "{{expectedRef}}",
              "sha":           "{{expectedSha}}"
            }
            """, Encoding.UTF8, "application/json"), cts.Token);
        Assert.True(post.StatusCode == HttpStatusCode.Created,
            $"Write API rejected the ref/sha POST ({(int)post.StatusCode}). SAD §10 Decision #10 forbids " +
            $"validation in this cycle. Body: {await post.Content.ReadAsStringAsync()}");

        // 3. Read SSE lines until we find a data frame matching our slot.
        var matchingData = await WaitForMatchingDataFrameAsync(reader, service, env, EventBudget, cts.Token);
        Assert.False(string.IsNullOrEmpty(matchingData),
            $"Did not receive an SSE data frame for {service}/{env} within {EventBudget.TotalSeconds}s. " +
            "Per SAD §5 NFR-03 the live update must arrive within 5s.");

        // 4. Assert the wire shape: ref + sha on state.current.
        using var parsed = JsonDocument.Parse(matchingData!);
        var root = parsed.RootElement;

        Assert.True(root.TryGetProperty("state", out var state),
            "SSE data envelope must include 'state' (SAD §7 'SSE slot-update data payload').");
        Assert.True(state.TryGetProperty("current", out var current),
            "SSE state.current must be present.");

        AssertWireValue(current, "ref", expectedRef, "SSE state.current.ref");
        AssertWireValue(current, "sha", expectedSha, "SSE state.current.sha");
    }

    [Fact]
    public async Task SseDataFrame_RefAndShaAreAbsentOrNull_WhenNotIngested()
    {
        // Symmetric assertion: a POST that omits ref + sha must result
        // in an SSE frame whose state.current also omits-or-nulls them.
        // The server MAY use either form (SAD §7 field rules) but MUST
        // NOT emit a stray non-null value.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        using var streamClient = new HttpClient { BaseAddress = new Uri(TestEnvironment.ReadBaseUrl) };
        streamClient.Timeout = Timeout.InfiniteTimeSpan;
        using var streamReq = new HttpRequestMessage(HttpMethod.Get, "/api/stream");
        streamReq.Headers.Accept.Clear();
        streamReq.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var streamResp = await streamClient.SendAsync(streamReq, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(HttpStatusCode.OK, streamResp.StatusCode);

        using var body = await streamResp.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(body, Encoding.UTF8);

        var suffix = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}";
        var service = $"qa-bot-sse-noref-{suffix[..16]}";
        var deploymentId = $"sse-noref-{suffix}";
        const string env = "fn-sse-noref";

        using var writeClient = TestEnvironment.CreateWriteClient();
        var post = await writeClient.PostAsync("/api/deployments", new StringContent(
            $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{env}}",
              "version":       "v0.0.{{DateTime.UtcNow.Ticks % 1_000_000}}",
              "status":        "success",
              "run_url":       "https://example.com/runs/sse-noref",
              "run_number":    99980,
              "actor":         "qa.bot"
            }
            """, Encoding.UTF8, "application/json"), cts.Token);
        Assert.Equal(HttpStatusCode.Created, post.StatusCode);

        var matchingData = await WaitForMatchingDataFrameAsync(reader, service, env, EventBudget, cts.Token);
        Assert.False(string.IsNullOrEmpty(matchingData),
            $"Did not receive an SSE data frame for {service}/{env} within {EventBudget.TotalSeconds}s.");

        using var parsed = JsonDocument.Parse(matchingData!);
        var root = parsed.RootElement;
        Assert.True(root.TryGetProperty("state", out var state));
        Assert.True(state.TryGetProperty("current", out var current));

        AssertAbsentOrNull(current, "ref", "SSE state.current.ref");
        AssertAbsentOrNull(current, "sha", "SSE state.current.sha");
    }

    // ------------------------------------------------ helpers

    private static async Task<string?> WaitForMatchingDataFrameAsync(
        StreamReader reader, string service, string env, TimeSpan budget, CancellationToken outer)
    {
        var deadline = DateTime.UtcNow + budget;
        while (DateTime.UtcNow < deadline && !outer.IsCancellationRequested)
        {
            var line = await ReadLineWithTimeoutAsync(reader, deadline - DateTime.UtcNow, outer);
            if (line is null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var payload = line["data:".Length..].TrimStart();
            if (string.IsNullOrEmpty(payload)) continue;
            try
            {
                using var doc = JsonDocument.Parse(payload);
                if (doc.RootElement.TryGetProperty("service", out var svc) &&
                    svc.ValueKind == JsonValueKind.String &&
                    svc.GetString() == service &&
                    doc.RootElement.TryGetProperty("environment", out var envProp) &&
                    envProp.GetString() == env)
                {
                    return payload;
                }
            }
            catch (JsonException) { /* non-JSON heartbeat — skip */ }
        }
        return null;
    }

    private static async Task<string?> ReadLineWithTimeoutAsync(StreamReader reader, TimeSpan budget, CancellationToken outer)
    {
        if (budget <= TimeSpan.Zero) return null;
        using var lineCts = CancellationTokenSource.CreateLinkedTokenSource(outer);
        lineCts.CancelAfter(budget);
        try
        {
            return await reader.ReadLineAsync(lineCts.Token).AsTask();
        }
        catch (OperationCanceledException) when (!outer.IsCancellationRequested)
        {
            return null;
        }
    }

    private static void AssertWireValue(JsonElement parent, string property, string expected, string label)
    {
        Assert.True(parent.TryGetProperty(property, out var prop),
            $"{label}: expected string '{expected}' but the property is absent from the SSE wire shape. " +
            "Per SAD §7 'SSE slot-update data payload' the property MUST be emitted when the stored value is non-null.");
        Assert.Equal(JsonValueKind.String, prop.ValueKind);
        Assert.Equal(expected, prop.GetString());
    }

    private static void AssertAbsentOrNull(JsonElement parent, string property, string label)
    {
        if (!parent.TryGetProperty(property, out var prop)) return;
        Assert.True(prop.ValueKind == JsonValueKind.Null,
            $"{label}: expected absent or JSON null (no value was ingested), but property kind is '{prop.ValueKind}' (value '{prop}'). " +
            "Per SAD §7 field rules 'absent and null are equivalent' when no value is stored.");
    }
}
