using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Shared.Json;

namespace Dashboard.Shared.Tests.Json;

/// <summary>
/// Unit tests for <see cref="RawJsonStringConverter"/> — the fix for the control-stream
/// <c>payload</c> wire bug (issue #423): a <c>string?</c> entity property holding pre-serialised
/// JSON text must appear as a native JSON object on the wire, not a doubly-escaped string.
/// </summary>
public sealed class RawJsonStringConverterTests
{
    private sealed class Wrapper
    {
        [JsonConverter(typeof(RawJsonStringConverter))]
        public string? Blob { get; set; }
    }

    private static readonly JsonSerializerOptions Options = new()
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    [Fact]
    public void Write_NonNullJsonString_EmitsNestedObject_NotQuotedString()
    {
        var wrapper = new Wrapper { Blob = """{"since":"2026-07-14T00:00:00+00:00"}""" };

        var json = JsonSerializer.Serialize(wrapper, Options);
        using var doc = JsonDocument.Parse(json);

        var blob = doc.RootElement.GetProperty("Blob");
        Assert.Equal(JsonValueKind.Object, blob.ValueKind);
        Assert.Equal("2026-07-14T00:00:00+00:00", blob.GetProperty("since").GetString());
    }

    [Fact]
    public void Write_NullValue_OmitsPropertyEntirely()
    {
        var wrapper = new Wrapper { Blob = null };

        var json = JsonSerializer.Serialize(wrapper, Options);

        Assert.DoesNotContain("Blob", json, StringComparison.Ordinal);
    }

    [Fact]
    public void ReadThenWrite_RoundTripsThroughRawText_ReproducesSameObjectShape()
    {
        // Mirrors the control-events NOTIFY -> ControlEventBroadcaster deserialize -> SSE
        // reserialize round-trip: the wire object shape must survive intact.
        const string original = """{"Blob":{"since":"2026-07-14T00:00:00+00:00","extra":[1,2,3]}}""";

        var deserialized = JsonSerializer.Deserialize<Wrapper>(original, Options)!;
        var reserialized = JsonSerializer.Serialize(deserialized, Options);

        using var doc = JsonDocument.Parse(reserialized);
        var blob = doc.RootElement.GetProperty("Blob");
        Assert.Equal(JsonValueKind.Object, blob.ValueKind);
        Assert.Equal("2026-07-14T00:00:00+00:00", blob.GetProperty("since").GetString());
        Assert.Equal(3, blob.GetProperty("extra").GetArrayLength());
    }

    [Fact]
    public void Read_JsonNull_ProducesNullString()
    {
        var wrapper = JsonSerializer.Deserialize<Wrapper>("""{"Blob":null}""", Options)!;

        Assert.Null(wrapper.Blob);
    }
}
