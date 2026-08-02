using System.Text.Json;
using Dashboard.Write.Contracts;
using Dashboard.Write.Validation;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="PresetBundleValidator"/> — no HTTP stack or database needed.
/// Covers the review-fix rules (issue #391): duplicate names within a bundle, and the
/// name length bounds (1..200) that DataAnnotations on <see cref="Preset"/> never actually enforce.
/// </summary>
public sealed class PresetBundleValidatorTests
{
    private readonly PresetBundleValidator _validator = new();

    private static readonly JsonElement EmptySettings = JsonDocument.Parse("{}").RootElement;

    private static Preset MakePreset(string name) => new()
    {
        Version = 1,
        Name = name,
        Settings = EmptySettings,
    };

    private static PresetBundle Bundle(params string[] names) => new()
    {
        Version = 1,
        Presets = names.Select(MakePreset).ToList(),
    };

    // ── Happy path ────────────────────────────────────────────────────────────

    [Fact]
    public void Validate_EmptyBundle_ReturnsNoFailures() =>
        Assert.Empty(_validator.Validate(Bundle()));

    [Fact]
    public void Validate_AllUniqueNames_ReturnsNoFailures() =>
        Assert.Empty(_validator.Validate(Bundle("fast-rollout", "canary", "default")));

    // ── Duplicate-name detection (would otherwise hit EF's composite-key AddRange → 500) ────────

    [Fact]
    public void Validate_DuplicateName_ReturnsPresetsPointerFailure()
    {
        var failures = _validator.Validate(Bundle("default", "default"));
        Assert.Contains(failures, f => f.Pointer == "/presets");
    }

    [Fact]
    public void Validate_DuplicateName_DoesNotReturnPerItemNameFailure()
    {
        // The duplicate names are each individually well-formed; only the bundle-level
        // uniqueness rule should fire, not a per-index "/presets/{i}/name" failure.
        var failures = _validator.Validate(Bundle("default", "default"));
        Assert.DoesNotContain(failures, f => f.Pointer.EndsWith("/name", StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_DuplicateName_IsCaseSensitive()
    {
        // "unique within a source's bundle" — exact (ordinal) match, not case-insensitive.
        var failures = _validator.Validate(Bundle("Default", "default"));
        Assert.DoesNotContain(failures, f => f.Pointer == "/presets");
    }

    [Fact]
    public void Validate_ThreeCopiesOfSameName_ReturnsSingleDuplicateFailure()
    {
        var failures = _validator.Validate(Bundle("default", "default", "default"));
        Assert.Single(failures, f => f.Pointer == "/presets");
    }

    // ── Name length bounds (1..200), inert via DataAnnotations — must be enforced explicitly ────

    [Fact]
    public void Validate_EmptyName_ReturnsNameFailure()
    {
        var failures = _validator.Validate(Bundle(""));
        Assert.Contains(failures, f => f.Pointer == "/presets/0/name");
    }

    [Fact]
    public void Validate_WhitespaceOnlyName_ReturnsNameFailure()
    {
        var failures = _validator.Validate(Bundle("   "));
        Assert.Contains(failures, f => f.Pointer == "/presets/0/name");
    }

    [Fact]
    public void Validate_NameExactly200Chars_ReturnsNoFailure()
    {
        var failures = _validator.Validate(Bundle(new string('x', 200)));
        Assert.DoesNotContain(failures, f => f.Pointer == "/presets/0/name");
    }

    [Fact]
    public void Validate_NameExceeds200Chars_ReturnsNameFailure()
    {
        var failures = _validator.Validate(Bundle(new string('x', 201)));
        Assert.Contains(failures, f => f.Pointer == "/presets/0/name");
    }

    [Fact]
    public void Validate_SecondItemNameTooLong_PointerIndexesCorrectItem()
    {
        var failures = _validator.Validate(Bundle("ok", new string('x', 201)));
        Assert.Contains(failures, f => f.Pointer == "/presets/1/name");
        Assert.DoesNotContain(failures, f => f.Pointer == "/presets/0/name");
    }
}
