using Dashboard.Fetcher.GitHub.Discovery;

namespace Dashboard.Fetcher.Tests.Discovery;

/// <summary>
/// Unit tests for <see cref="PresetFileParser"/> — SINGLE-OR-BUNDLE parsing of
/// <c>.deployment-dashboard/*.json</c> files (issue #391 / §5.6.2).
/// </summary>
public sealed class PresetFileParserTests
{
    [Fact]
    public void Parse_SingleShape_ReturnsOnePreset()
    {
        const string json = """{"version":1,"name":"Prod defaults","settings":{"theme":"dark"}}""";

        var result = PresetFileParser.Parse(json);

        var entry = Assert.Single(result);
        Assert.Equal("Prod defaults", entry.Name);
        Assert.Equal("dark", entry.Settings.GetProperty("theme").GetString());
    }

    [Fact]
    public void Parse_BundleShape_ReturnsAllPresets()
    {
        const string json = """
            {
              "version": 1,
              "presets": [
                {"version":1,"name":"A","settings":{"x":1}},
                {"version":1,"name":"B","settings":{"x":2}}
              ]
            }
            """;

        var result = PresetFileParser.Parse(json);

        Assert.Equal(2, result.Count);
        Assert.Equal("A", result[0].Name);
        Assert.Equal("B", result[1].Name);
    }

    [Fact]
    public void Parse_BundleShape_EmptyPresetsArray_ReturnsEmpty()
    {
        const string json = """{"version":1,"presets":[]}""";

        var result = PresetFileParser.Parse(json);

        Assert.Empty(result);
    }

    [Fact]
    public void Parse_MalformedJson_Throws()
    {
        const string json = "{not-json";

        Assert.ThrowsAny<Exception>(() => PresetFileParser.Parse(json));
    }

    [Fact]
    public void Parse_MissingName_Throws()
    {
        const string json = """{"version":1,"settings":{"theme":"dark"}}""";

        Assert.Throws<FormatException>(() => PresetFileParser.Parse(json));
    }

    [Fact]
    public void Parse_MissingSettings_Throws()
    {
        const string json = """{"version":1,"name":"Prod defaults"}""";

        Assert.Throws<FormatException>(() => PresetFileParser.Parse(json));
    }

    [Fact]
    public void Parse_PresetsNotAnArray_Throws()
    {
        const string json = """{"version":1,"presets":"nope"}""";

        Assert.Throws<FormatException>(() => PresetFileParser.Parse(json));
    }

    [Fact]
    public void Parse_RootNotAnObject_Throws()
    {
        const string json = "[1,2,3]";

        Assert.Throws<FormatException>(() => PresetFileParser.Parse(json));
    }

    [Fact]
    public void Parse_EmptyName_Throws()
    {
        const string json = """{"version":1,"name":"","settings":{}}""";

        Assert.Throws<FormatException>(() => PresetFileParser.Parse(json));
    }
}
