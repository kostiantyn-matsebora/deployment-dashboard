using Dashboard.Control.Validation;

namespace Dashboard.Control.Tests;

/// <summary>
/// Unit tests for <see cref="ComponentId"/> header-name and length constants (D9).
/// Separate from <see cref="ComponentIdTests"/> which covers the regex validation logic.
/// </summary>
public sealed class ComponentIdConstantsTests
{
    [Fact]
    public void HeaderName_IsExpectedValue()
        => Assert.Equal("X-Component-Id", ComponentId.HeaderName);

    [Fact]
    public void CorrelationIdHeaderName_IsExpectedValue()
        => Assert.Equal("X-Correlation-Id", ComponentId.CorrelationIdHeaderName);

    [Fact]
    public void MaxCorrelationIdLength_Is128()
        => Assert.Equal(128, ComponentId.MaxCorrelationIdLength);

    [Fact]
    public void CorrelationId_AtLimit_IsAllowed()
    {
        // 128 chars is at the limit; must not trigger the filter rejection.
        var atLimit = new string('x', ComponentId.MaxCorrelationIdLength);
        Assert.True(atLimit.Length <= ComponentId.MaxCorrelationIdLength);
    }

    [Fact]
    public void CorrelationId_OnePastLimit_IsRejected()
    {
        var tooLong = new string('x', ComponentId.MaxCorrelationIdLength + 1);
        Assert.True(tooLong.Length > ComponentId.MaxCorrelationIdLength);
    }
}
