using System.Text;
using System.Text.Json;
using Dashboard.Shared.Domain;
using Dashboard.Shared.Dto;
using Dashboard.Shared.Json;
using Dashboard.Shared.Realtime;

namespace Dashboard.Shared.Tests.Realtime;

/// <summary>
/// Locks the SSE wire format from SAD §7 Real-time path:
/// <code>
/// id: &lt;monotonic&gt;
/// event: slot-update
/// data: &lt;json&gt;
/// &lt;blank line&gt;
/// </code>
/// The <c>data:</c> JSON shape is the wrapped slot-update payload defined
/// in SAD §7 "SSE <c>slot-update</c> data payload":
/// <c>{ service, environment, state: { current, lastSuccessful, previousFailed } }</c>.
///
/// <para><strong>Topology is NOT carried on the SSE wire</strong> — see SAD
/// §7 "SSE topology semantics — single source of truth" and Decision §10 #8.
/// Tests below assert the absence of <c>"topology"</c> in the data payload.</para>
/// </summary>
public sealed class SseWriterTests
{
    private static SlotUpdatePayload SamplePayload() => new()
    {
        Service = "auth-service",
        Environment = "prod",
        State = new MatrixSlot
        {
            Current = new CurrentDeployment
            {
                DeploymentId = "gh-run-1185",
                Version = "v1.7.7",
                Status = DeploymentStatus.Success,
                RunUrl = "https://example.com/runs/1185",
                RunNumber = 1185,
                Actor = "bob.wilson",
                DeployedAt = new DateTime(2026, 4, 30, 9, 15, 0, DateTimeKind.Utc),
                ParentDeployments = new[] { "gh-run-1180" },
            },
            LastSuccessful = null,
            PreviousFailed = false,
        },
    };

    [Fact]
    public void FormatFrame_EmitsThreeFieldsAndBlankLineTerminator()
    {
        var update = new SlotUpdate(7, SamplePayload());
        var bytes = SseWriter.FormatFrame(update);
        var text = Encoding.UTF8.GetString(bytes);

        Assert.StartsWith("id: 7\n", text);
        Assert.Contains("event: slot-update\n", text);
        Assert.Contains("data: {", text);
        // A blank line (two consecutive newlines) terminates the event per
        // the SSE spec. Without it browsers will buffer indefinitely.
        Assert.EndsWith("\n\n", text);
    }

    [Fact]
    public void FormatFrame_PayloadIsWrappedSlotUpdateShape()
    {
        var bytes = SseWriter.FormatFrame(new SlotUpdate(1, SamplePayload()));
        var text = Encoding.UTF8.GetString(bytes);

        // Top-level wrapper — SAD §7 SSE payload shape.
        Assert.Contains("\"service\":\"auth-service\"", text);
        Assert.Contains("\"environment\":\"prod\"", text);
        Assert.Contains("\"state\":{", text);

        // Inner state mirrors the REST per-slot shape (camelCase keys for
        // lastSuccessful / previousFailed are pinned by JsonPropertyName).
        Assert.Contains("\"current\":{", text);
        Assert.Contains("\"lastSuccessful\":", text);
        Assert.Contains("\"previousFailed\":false", text);

        // Deployment record fields stay snake_case on the inner object.
        Assert.Contains("\"run_url\":\"https://example.com/runs/1185\"", text);
        Assert.Contains("\"run_number\":1185", text);
        Assert.Contains("\"deployed_at\":", text);

        // Surfaced parent_deployments per SAD "Matrix response shape" rules.
        Assert.Contains("\"deployment_id\":\"gh-run-1185\"", text);
        Assert.Contains("\"parent_deployments\":[\"gh-run-1180\"]", text);
    }

    [Fact]
    public void FormatFrame_DoesNotIncludeTopologyKey()
    {
        // SAD §7 "SSE topology semantics — single source of truth":
        // "Topology is not carried on the SSE wire — clients refresh
        // topology via GET /api/deployments after each event."
        var bytes = SseWriter.FormatFrame(new SlotUpdate(2, SamplePayload()));
        var text = Encoding.UTF8.GetString(bytes);

        Assert.DoesNotContain("\"topology\"", text);
        Assert.DoesNotContain("\"edges\"", text);
        Assert.DoesNotContain("\"source\":\"explicit\"", text);
        Assert.DoesNotContain("\"source\":\"correlated\"", text);
    }

    [Fact]
    public void FormatFrame_DataLineDeserialisesBackToWrappedPayload()
    {
        var bytes = SseWriter.FormatFrame(new SlotUpdate(11, SamplePayload()));
        var text = Encoding.UTF8.GetString(bytes);

        // Extract the data: line and confirm it parses into the wrapper —
        // this is the exact contract the frontend SseService relies on.
        var dataLine = text
            .Split('\n')
            .Single(l => l.StartsWith("data: ", StringComparison.Ordinal))
            ["data: ".Length..];

        var roundTripped = JsonSerializer.Deserialize<SlotUpdatePayload>(
            dataLine, DashboardJson.Options);

        Assert.NotNull(roundTripped);
        Assert.Equal("auth-service", roundTripped!.Service);
        Assert.Equal("prod", roundTripped.Environment);
        Assert.Equal("v1.7.7", roundTripped.State.Current.Version);
        Assert.Equal(DeploymentStatus.Success, roundTripped.State.Current.Status);
        Assert.Null(roundTripped.State.LastSuccessful);
        Assert.False(roundTripped.State.PreviousFailed);
    }

    [Fact]
    public void FormatHeartbeat_IsCommentLine()
    {
        var bytes = SseWriter.FormatHeartbeat();
        var text = Encoding.UTF8.GetString(bytes);

        Assert.StartsWith(":", text);
        Assert.EndsWith("\n\n", text);
    }

    [Theory]
    [InlineData(null, 0)]
    [InlineData("", 0)]
    [InlineData("not-a-number", 0)]
    [InlineData("-5", 0)]
    [InlineData("42", 42)]
    public void ParseLastEventId_HandlesBadInputGracefully(string? raw, long expected)
    {
        Assert.Equal(expected, SseWriter.ParseLastEventId(raw));
    }

    // ──────────────────────────────────────────────────────────────────────
    // CR-0009 + ADR-0004 — progress_reporter on the SSE wire
    //
    // The Read API surfaces the new optional attribute everywhere it already
    // surfaces per-event fields (history + matrix current / lastSuccessful +
    // SSE slot-update.state). The shape test below ensures the SSE wire
    // explicitly carries the field — both when populated and when null
    // (always-emit convention, matching the ref / sha precedent).
    // ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void FormatFrame_PayloadIncludesProgressReporter_WhenSet()
    {
        var payload = new SlotUpdatePayload
        {
            Service = "auth-service",
            Environment = "prod",
            State = new MatrixSlot
            {
                Current = new CurrentDeployment
                {
                    DeploymentId = "gh-run-9001",
                    Version = "v1.0.0",
                    Status = DeploymentStatus.Success,
                    RunUrl = "https://example.com/runs/9001",
                    RunNumber = 9001,
                    Actor = "system",
                    DeployedAt = new DateTime(2026, 5, 18, 10, 0, 0, DateTimeKind.Utc),
                    ProgressReporter = "dashboard-fetcher/github-actions",
                },
                LastSuccessful = null,
                PreviousFailed = false,
            },
        };

        var bytes = SseWriter.FormatFrame(new SlotUpdate(1, payload));
        var text = Encoding.UTF8.GetString(bytes);

        Assert.Contains("\"progress_reporter\":\"dashboard-fetcher/github-actions\"", text);
    }

    [Fact]
    public void FormatFrame_PayloadAlwaysIncludesProgressReporterKey_NullWhenUnset()
    {
        // SamplePayload doesn't set ProgressReporter — the resulting JSON must
        // still include the key as `null` (the always-emit convention used by
        // ref / sha). SPA consumers pattern-match on the key's presence.
        var bytes = SseWriter.FormatFrame(new SlotUpdate(2, SamplePayload()));
        var text = Encoding.UTF8.GetString(bytes);

        Assert.Contains("\"progress_reporter\":null", text);
    }
}
