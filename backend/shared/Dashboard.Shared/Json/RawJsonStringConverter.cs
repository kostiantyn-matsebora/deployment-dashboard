using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dashboard.Shared.Json;

/// <summary>
/// (De)serialises a <c>string?</c> property that holds a verbatim, pre-serialised JSON blob
/// (e.g. an opaque <c>jsonb</c>/<c>TEXT</c> column) as a native nested JSON value on the wire,
/// instead of a doubly-escaped JSON string.
/// </summary>
/// <remarks>
/// <para>
/// <b>Write:</b> parses the stored string as JSON and writes it through as an object/array/etc.
/// <c>null</c> is written as JSON <c>null</c> — callers that also set
/// <see cref="JsonIgnoreCondition.WhenWritingNull"/> on the property never reach this branch,
/// since System.Text.Json skips the converter entirely for a null reference-type value.
/// </para>
/// <para>
/// <b>Read:</b> captures the exact raw JSON text of whatever value is present (object, array,
/// string, number, bool) via <see cref="JsonDocument.ParseValue"/> and stores it back into the
/// string verbatim — so a deserialize→reserialize round-trip (e.g. the control-event
/// broadcaster's NOTIFY→SSE relay) reproduces the identical shape.
/// </para>
/// </remarks>
public sealed class RawJsonStringConverter : JsonConverter<string?>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null)
            return null;

        using var doc = JsonDocument.ParseValue(ref reader);
        return doc.RootElement.GetRawText();
    }

    public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        using var doc = JsonDocument.Parse(value);
        doc.RootElement.WriteTo(writer);
    }
}
