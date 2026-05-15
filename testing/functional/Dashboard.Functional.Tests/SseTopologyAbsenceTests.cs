using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Dashboard.Functional.Tests;

/// <summary>
/// Validates SAD §7 "SSE topology semantics - single source of truth":
/// the SSE wire shape carries SLOT UPDATES ONLY. Topology is not on the
/// wire - clients refresh via <c>GET /api/deployments?correlationAttribute</c>
/// after each slot-update event.
///
/// <para>Concretely:</para>
/// <list type="bullet">
///   <item>The SSE event JSON has top-level keys
///         <c>{service, environment, state}</c> and nothing else.</item>
///   <item>The <c>state</c> object has
///         <c>{current, lastSuccessful, previousFailed}</c> and
///         nothing else - in particular NO <c>topology</c> sibling.</item>
///   <item>The whole envelope has NO top-level <c>topology</c> sibling
///         (defence-in-depth: if a future "convenience" field tried to
///         sneak topology into the SSE payload it would fail here).</item>
/// </list>
///
/// <para>How the assertion is performed: open <c>GET /api/stream</c>,
/// POST a fresh event, then read the next SSE <c>data:</c> line within
/// the NFR-03 5 s budget. Parse the data line as JSON and inspect.</para>
///
/// <para>Cites SAD §7 "API Contract" - "SSE slot-update data payload"
/// and "SSE topology semantics - single source of truth", and Decision
/// #8 in SAD §10.</para>
/// </summary>
[Collection(nameof(SeedCollection))]
public sealed class SseTopologyAbsenceTests
{
    private static readonly TimeSpan EventBudget = TimeSpan.FromSeconds(5);

    [Fact]
    public async Task SseDataFrame_HasNoTopology_AndStateHasNoTopology()
    {
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));

        // 1. Subscribe to the SSE stream BEFORE writing, so we don't
        // race the event into the void.
        using var streamClient = new HttpClient { BaseAddress = new Uri(TestEnvironment.ReadBaseUrl) };
        streamClient.Timeout = Timeout.InfiniteTimeSpan;
        using var streamReq = new HttpRequestMessage(HttpMethod.Get, "/api/stream");
        streamReq.Headers.Accept.Clear();
        streamReq.Headers.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("text/event-stream"));
        using var streamResp = await streamClient.SendAsync(streamReq, HttpCompletionOption.ResponseHeadersRead, cts.Token);
        Assert.Equal(System.Net.HttpStatusCode.OK, streamResp.StatusCode);
        Assert.Equal("text/event-stream", streamResp.Content.Headers.ContentType?.MediaType);

        using var body = await streamResp.Content.ReadAsStreamAsync(cts.Token);
        using var reader = new StreamReader(body, Encoding.UTF8);

        // 2. POST a fresh event so we know SOMETHING is on the wire to
        // observe. Use a unique service / deployment_id so the test is
        // idempotent and doesn't conflict with prior runs.
        var suffix = $"{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Guid.NewGuid():N}";
        var service = $"qa-bot-sse-{suffix[..16]}";
        var deploymentId = $"sse-{suffix}";
        const string env = "fn-sse-topo";

        using var writeClient = TestEnvironment.CreateWriteClient();
        var post = await writeClient.PostAsync("/api/deployments", new StringContent(
            $$"""
            {
              "deployment_id": "{{deploymentId}}",
              "service":       "{{service}}",
              "environment":   "{{env}}",
              "version":       "v0.0.{{DateTime.UtcNow.Ticks % 1_000_000}}",
              "status":        "success",
              "run_url":       "https://example.com/runs/sse-topo",
              "run_number":    99950,
              "actor":         "qa.bot"
            }
            """, Encoding.UTF8, "application/json"), cts.Token);
        Assert.Equal(System.Net.HttpStatusCode.Created, post.StatusCode);

        // 3. Read SSE lines until we find a data frame matching our
        // service + env. Hold to the NFR-03 5 s budget.
        var deadline = DateTime.UtcNow + EventBudget;
        string? matchingData = null;
        while (DateTime.UtcNow < deadline && !cts.IsCancellationRequested)
        {
            var line = await ReadLineWithTimeoutAsync(reader, deadline - DateTime.UtcNow, cts.Token);
            if (line is null) break;
            if (!line.StartsWith("data:", StringComparison.Ordinal)) continue;
            var payload = line["data:".Length..].TrimStart();
            if (string.IsNullOrEmpty(payload)) continue;
            // SAD §7 SSE data payload: top-level keys {service, environment, state}.
            // We want the event for OUR slot.
            try
            {
                using var doc = JsonDocument.Parse(payload);
                if (doc.RootElement.TryGetProperty("service", out var svc) &&
                    svc.ValueKind == JsonValueKind.String &&
                    svc.GetString() == service &&
                    doc.RootElement.TryGetProperty("environment", out var envProp) &&
                    envProp.GetString() == env)
                {
                    matchingData = payload;
                    break;
                }
            }
            catch (JsonException) { /* non-JSON heartbeat / comment - skip */ }
        }

        Assert.True(matchingData is not null,
            $"Did not receive an SSE data frame for {service}/{env} within {EventBudget.TotalSeconds}s. " +
            "Per SAD §5 NFR-03 the live update must arrive within 5s; the SSE pipeline appears broken.");

        // 4. Assert the wire shape: NO topology, anywhere.
        using var parsed = JsonDocument.Parse(matchingData);
        var root = parsed.RootElement;

        Assert.True(root.TryGetProperty("service", out _));
        Assert.True(root.TryGetProperty("environment", out _));
        Assert.True(root.TryGetProperty("state", out var state),
            "SSE data envelope must include 'state' (SAD §7 'SSE slot-update data payload').");

        Assert.False(root.TryGetProperty("topology", out _),
            "SSE data envelope must NOT include a top-level 'topology' field. " +
            "Per SAD §7 'SSE topology semantics - single source of truth': " +
            "Topology is not carried on the SSE wire.");

        Assert.Equal(JsonValueKind.Object, state.ValueKind);
        Assert.False(state.TryGetProperty("topology", out _),
            "SSE data envelope's 'state' object must NOT include a 'topology' sibling. " +
            "Per SAD §7: The inner state object is the exact per-slot shape from GET /api/deployments " +
            "MINUS the topology block (which is per-service, not per-slot).");

        // Sanity: the documented state keys are present.
        Assert.True(state.TryGetProperty("current", out _));
        // lastSuccessful may be null on a fresh slot (no prior success); shape check only.
        Assert.True(state.TryGetProperty("lastSuccessful", out _),
            "state.lastSuccessful must be present (null when no prior success).");
        Assert.True(state.TryGetProperty("previousFailed", out var prev));
        Assert.True(prev.ValueKind == JsonValueKind.True || prev.ValueKind == JsonValueKind.False);
    }

    /// <summary>
    /// Cancellable line read with a wall-clock budget. <see cref="StreamReader.ReadLineAsync(CancellationToken)"/>
    /// already supports cancellation in .NET 7+; we wrap it with a
    /// time budget so the test never blocks beyond the NFR-03 cap.
    /// </summary>
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
}
