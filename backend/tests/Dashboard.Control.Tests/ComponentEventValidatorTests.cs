using System.Text.Json;
using Dashboard.Control.Validation;
using Dashboard.Shared.Contracts;

namespace Dashboard.Control.Tests;

/// <summary>Unit tests for <see cref="ComponentEventValidator"/>.</summary>
public sealed class ComponentEventValidatorTests
{
    private readonly ComponentEventValidator _validator = new();

    private static ComponentEventIngest Valid() => new()
    {
        EventType = "status",
        State = ComponentState.Running,
        OccurredAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public void Validate_ValidBody_NoFailures()
        => Assert.Empty(_validator.Validate(Valid()));

    [Theory]
    [InlineData("running")]
    [InlineData("idle")]
    [InlineData("paused")]
    [InlineData("error")]
    public void Validate_AcceptsAllStateEnumValues(string state)
        => Assert.Empty(_validator.Validate(Valid() with { State = state }));

    [Fact]
    public void Validate_InvalidState_FlagsStatePointer()
    {
        var failures = _validator.Validate(Valid() with { State = "bogus" });

        Assert.Contains(failures, f => f.Pointer == "/state");
    }

    [Fact]
    public void Validate_EmptyEventType_Fails()
    {
        var failures = _validator.Validate(Valid() with { EventType = "" });

        Assert.Contains(failures, f => f.Pointer == "/event_type");
    }

    [Fact]
    public void Validate_DetailOver512Chars_FlagsDetailPointer()
    {
        var failures = _validator.Validate(Valid() with { Detail = new string('x', 513) });

        Assert.Contains(failures, f => f.Pointer == "/detail");
    }

    [Fact]
    public void Validate_DetailAtLimit_Ok()
        => Assert.Empty(_validator.Validate(Valid() with { Detail = new string('x', 512) }));

    [Fact]
    public void Validate_WithPayload_Ok()
    {
        var payload = JsonSerializer.Deserialize<JsonElement>("""{"adapter":"github-actions","count":42}""");
        Assert.Empty(_validator.Validate(Valid() with { Payload = payload }));
    }
}
