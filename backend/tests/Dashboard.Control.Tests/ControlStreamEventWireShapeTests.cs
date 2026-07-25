using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Control.Services;
using Dashboard.Shared.Entities;

namespace Dashboard.Control.Tests;

/// <summary>
/// Regression coverage for issue #423's control-stream wire bug: <see cref="ControlStreamEvent.Payload"/>
/// is stored as raw JSON text (<see cref="RecoverPayload.Build"/>) but MUST serialise on the wire as
/// a nested JSON object per <c>docs/api/openapi.yaml</c> (<c>ControlStreamEvent.payload: type: object,
/// nullable: true</c>) — not a quoted JSON string. Options below mirror the global snake_case +
/// null-omit policy shared by <c>ControlEndpoints.SseJsonOptions</c> (SSE <c>data:</c> frames) and the
/// <c>PostgresControlEventNotifier</c> / <c>ControlEventBroadcaster</c> NOTIFY round-trip.
/// </summary>
public sealed class ControlStreamEventWireShapeTests
{
    private static readonly JsonSerializerOptions WireOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static ControlStreamEvent RecoverCompletedEvent(DateTimeOffset since) => new()
    {
        Id = Guid.CreateVersion7(),
        Type = "recover-completed",
        Component = "*",
        CorrelationId = Guid.CreateVersion7(),
        OccurredAt = DateTimeOffset.UtcNow,
        Payload = RecoverPayload.Build(since),
    };

    [Fact]
    public void Serialize_RecoverCompletedFrame_PayloadIsNestedJsonObject_NotQuotedString()
    {
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var ev = RecoverCompletedEvent(since);

        var json = JsonSerializer.Serialize(ev, WireOptions);
        using var doc = JsonDocument.Parse(json);

        var payload = doc.RootElement.GetProperty("payload");
        Assert.Equal(JsonValueKind.Object, payload.ValueKind); // was JsonValueKind.String before the fix
        Assert.Equal(since, payload.GetProperty("since").GetDateTimeOffset());
    }

    [Fact]
    public void Serialize_ResetFrame_NullPayload_OmitsPayloadKey()
    {
        var ev = new ControlStreamEvent
        {
            Id = Guid.CreateVersion7(),
            Type = "reset-initiated",
            Component = "*",
            OccurredAt = DateTimeOffset.UtcNow,
            Payload = null,
        };

        var json = JsonSerializer.Serialize(ev, WireOptions);
        using var doc = JsonDocument.Parse(json);

        Assert.False(doc.RootElement.TryGetProperty("payload", out _));
    }

    [Fact]
    public void NotifyThenBroadcastRoundTrip_PreservesNestedObjectShape()
    {
        // Simulates PostgresControlEventNotifier.NotifyAsync (serialize for pg_notify) followed by
        // ControlEventBroadcaster.ResolveAsync (deserialize) and a second SSE serialize — the exact
        // path that was silently double-string-escaping payload before the fix.
        var since = new DateTimeOffset(2026, 7, 14, 0, 0, 0, TimeSpan.Zero);
        var original = RecoverCompletedEvent(since);

        var notifyPayload = JsonSerializer.Serialize(original, WireOptions);
        var resolved = JsonSerializer.Deserialize<ControlStreamEvent>(notifyPayload, WireOptions)!;
        var sseFrameJson = JsonSerializer.Serialize(resolved, WireOptions);

        using var doc = JsonDocument.Parse(sseFrameJson);
        var payload = doc.RootElement.GetProperty("payload");
        Assert.Equal(JsonValueKind.Object, payload.ValueKind);
        Assert.Equal(since, payload.GetProperty("since").GetDateTimeOffset());
    }
}
