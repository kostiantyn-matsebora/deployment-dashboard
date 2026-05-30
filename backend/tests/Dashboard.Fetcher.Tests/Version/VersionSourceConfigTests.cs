using Dashboard.Fetcher.GitHub.Version;

namespace Dashboard.Fetcher.Tests.Version;

public sealed class VersionSourceConfigTests
{
    [Theory]
    [InlineData("attribute:sha", VersionSourceType.Attribute, "sha")]
    [InlineData("attribute:ref", VersionSourceType.Attribute, "ref")]
    [InlineData("payload:version", VersionSourceType.Payload, "version")]
    [InlineData("artifact:v.txt", VersionSourceType.Artifact, "v.txt")]
    public void Parse_ValidInput_ReturnsCorrectTypeAndKey(string raw, VersionSourceType type, string key)
    {
        var config = VersionSourceConfig.Parse(raw);
        Assert.Equal(type, config.Type);
        Assert.Equal(key, config.Key);
    }

    [Fact]
    public void Parse_MalformedInput_ReturnsDefault()
    {
        var config = VersionSourceConfig.Parse("no-colon");
        Assert.Equal(VersionSourceConfig.Default.Type, config.Type);
        Assert.Equal(VersionSourceConfig.Default.Key, config.Key);
    }

    [Fact]
    public void Default_IsAttributeSha()
    {
        Assert.Equal(VersionSourceType.Attribute, VersionSourceConfig.Default.Type);
        Assert.Equal("sha", VersionSourceConfig.Default.Key);
    }
}
