using Dashboard.Shared.Http;

namespace Dashboard.Write.Tests;

/// <summary>
/// Unit tests for <see cref="SizeLimitGuard"/> — the shared byte/size-cap→413-Problem idiom
/// extracted from <c>PresetEndpoints.ValidateBundleSize</c> and <c>FetcherStateEndpoints.HandlePutAsync</c>
/// (issue #391 review). No HTTP stack needed; verifies the pure comparison and that each call
/// site's exact title/detail text passes through unchanged.
/// </summary>
public sealed class SizeLimitGuardTests
{
    // ── EnsureWithinBytes (UTF-8 byte count) ─────────────────────────────────

    [Fact]
    public void EnsureWithinBytes_UnderCap_ReturnsNull() =>
        Assert.Null(SizeLimitGuard.EnsureWithinBytes("{}", maxBytes: 100, "title", "detail"));

    [Fact]
    public void EnsureWithinBytes_ExactlyAtCap_ReturnsNull()
    {
        var json = new string('x', 10);
        Assert.Null(SizeLimitGuard.EnsureWithinBytes(json, maxBytes: 10, "title", "detail"));
    }

    [Fact]
    public void EnsureWithinBytes_OverCap_ReturnsTitleAndDetailUnchanged()
    {
        var json = new string('x', 11);
        var result = SizeLimitGuard.EnsureWithinBytes(json, maxBytes: 10, "Bundle exceeds the size limit.", "detail text");

        Assert.NotNull(result);
        Assert.Equal("Bundle exceeds the size limit.", result.Value.Title);
        Assert.Equal("detail text", result.Value.Detail);
    }

    [Fact]
    public void EnsureWithinBytes_MultiByteCharacters_CountsUtf8BytesNotCharCount()
    {
        // "é" is 1 char but 2 UTF-8 bytes; 6 copies = 6 chars but 12 bytes.
        var json = new string('é', 6);
        Assert.Null(SizeLimitGuard.EnsureWithinBytes(json, maxBytes: 12, "title", "detail"));
        Assert.NotNull(SizeLimitGuard.EnsureWithinBytes(json, maxBytes: 11, "title", "detail"));
    }

    // ── EnsureWithinSize (caller-supplied magnitude, e.g. FetcherState's char-length cap) ────────

    [Fact]
    public void EnsureWithinSize_UnderCap_ReturnsNull() =>
        Assert.Null(SizeLimitGuard.EnsureWithinSize(actualSize: 5, maxSize: 10, "title", "detail"));

    [Fact]
    public void EnsureWithinSize_ExactlyAtCap_ReturnsNull() =>
        Assert.Null(SizeLimitGuard.EnsureWithinSize(actualSize: 10, maxSize: 10, "title", "detail"));

    [Fact]
    public void EnsureWithinSize_OverCap_ReturnsTitleAndDetailUnchanged()
    {
        var result = SizeLimitGuard.EnsureWithinSize(
            actualSize: 8193, maxSize: 8192, "Cursor exceeds the size limit.", "The cursor must not exceed 8192 characters.");

        Assert.NotNull(result);
        Assert.Equal("Cursor exceeds the size limit.", result.Value.Title);
        Assert.Equal("The cursor must not exceed 8192 characters.", result.Value.Detail);
    }
}
