using Dashboard.Control.Validation;

namespace Dashboard.Control.Tests;

/// <summary>Unit tests for the <c>X-Component-Id</c> header pattern (D9).</summary>
public sealed class ComponentIdTests
{
    [Theory]
    [InlineData("dashboard-fetcher")]
    [InlineData("dashboard-fetcher.github-actions")]
    [InlineData("demo-driver")]
    [InlineData("a")]
    [InlineData("0")]
    [InlineData("svc-1.adapter-2.sub-3")]
    public void IsValid_AcceptsConformingIds(string id)
        => Assert.True(ComponentId.IsValid(id));

    [Theory]
    [InlineData(null)]                 // missing
    [InlineData("")]                   // empty
    [InlineData("-leading-hyphen")]    // must start alnum
    [InlineData(".leading-dot")]       // must start alnum
    [InlineData("Upper-Case")]         // no uppercase
    [InlineData("has space")]          // no spaces
    [InlineData("under_score")]        // underscore not allowed
    public void IsValid_RejectsNonConformingIds(string? id)
        => Assert.False(ComponentId.IsValid(id));

    [Fact]
    public void IsValid_RejectsOverlongId()
    {
        // First char + 128 more = 129 chars → exceeds the {0,127} bound.
        var tooLong = "a" + new string('b', 128);
        Assert.False(ComponentId.IsValid(tooLong));
    }

    [Fact]
    public void IsValid_AcceptsMaxLengthId()
    {
        // First char + 127 more = 128 chars → at the {0,127} bound.
        var atLimit = "a" + new string('b', 127);
        Assert.True(ComponentId.IsValid(atLimit));
    }
}
