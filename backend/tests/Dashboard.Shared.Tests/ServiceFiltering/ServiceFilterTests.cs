using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Shared.Tests.ServiceFiltering;

/// <summary>
/// Unit tests for <see cref="ServiceFilter"/> (opaque namespace/service composite identity model)
/// and the <see cref="Glob"/> helper. No mocks — all real implementations.
/// </summary>
public sealed class ServiceFilterTests
{
    // ── Glob helper ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData("api", "api", true)]
    [InlineData("api", "web", false)]
    [InlineData("api*", "api", true)]
    [InlineData("api*", "api-gateway", true)]
    [InlineData("*api", "api", true)]
    [InlineData("*api", "my-api", true)]
    [InlineData("*api", "apix", false)]
    [InlineData("*", "anything", true)]
    [InlineData("*", "", true)]
    [InlineData("front-*", "front-web", true)]
    [InlineData("front-*", "back-end", false)]
    [InlineData("a*b", "ab", true)]
    [InlineData("a*b", "a-middle-b", true)]
    [InlineData("a*b", "ax", false)]
    // Glob spans '/' — used by composite patterns
    [InlineData("acme/api/checkout", "acme/api/checkout", true)]
    [InlineData("acme/api/checkout", "acme/api/billing", false)]
    [InlineData("acme/*", "acme/api/checkout", true)]
    [InlineData("*/checkout", "api/checkout", true)]
    [InlineData("*/checkout", "acme/api/checkout", true)]
    public void Glob_Matches_VariousPatterns(string pattern, string value, bool expected)
    {
        Assert.Equal(expected, Glob.Matches(pattern, value));
    }

    // ── Empty defaults (pass-all) ─────────────────────────────────────────────

    [Fact]
    public void PassAll_PermitsAnyServiceAndNamespace()
    {
        var filter = ServiceFilter.PassAll;

        Assert.True(filter.Permits("any-service", "any-namespace"));
        Assert.True(filter.Permits("my-api", null));
        Assert.True(filter.IsEmpty);
    }

    [Fact]
    public void ParseNull_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse(null);

        Assert.True(filter.IsEmpty);
        Assert.True(filter.Permits("svc", "ns"));
        Assert.True(filter.Permits("svc", null));
    }

    [Fact]
    public void ParseEmptyString_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse("");

        Assert.True(filter.IsEmpty);
        Assert.True(filter.Permits("anything", "anywhere"));
    }

    [Fact]
    public void ParseWhitespace_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse("   ");

        Assert.True(filter.IsEmpty);
        Assert.True(filter.Permits("any-svc", "any-ns"));
    }

    // ── Slashless pattern (service only) ─────────────────────────────────────

    [Fact]
    public void SlashlessPattern_ExcludesMatchingServiceAcrossAllNamespaces()
    {
        var filter = ServiceFilter.Parse("checkout");

        Assert.True(filter.IsExcluded("checkout", "any-ns"));
        Assert.True(filter.IsExcluded("checkout", null));
        Assert.True(filter.IsExcluded("checkout", "org-a"));
        Assert.False(filter.IsExcluded("billing", "any-ns"));
    }

    [Fact]
    public void SlashlessPattern_Wildcard_ExcludesEverything()
    {
        var filter = ServiceFilter.Parse("*");

        Assert.True(filter.IsExcluded("any-service", null));
        Assert.True(filter.IsExcluded("checkout", "acme"));
    }

    [Fact]
    public void SlashlessPattern_GlobSuffix_ExcludesMatchingServices()
    {
        var filter = ServiceFilter.Parse("legacy-*");

        Assert.True(filter.IsExcluded("legacy-crm", null));
        Assert.True(filter.IsExcluded("legacy-payments", "acme"));
        Assert.False(filter.IsExcluded("checkout", null));
    }

    // ── Pattern WITH slash — composite namespace/service identity ─────────────

    [Fact]
    public void SlashedPattern_ExcludesMatchingCompositeIdentity()
    {
        // "org-a/gateway" matches identity "org-a/gateway" exactly.
        var filter = ServiceFilter.Parse("org-a/gateway");

        Assert.True(filter.IsExcluded("gateway", "org-a"));
        Assert.False(filter.IsExcluded("gateway", "org-b"));
        Assert.False(filter.IsExcluded("gateway", null));   // null → identity="gateway", no slash in pattern
        Assert.False(filter.IsExcluded("billing", "org-a"));
    }

    [Fact]
    public void SlashedPattern_StarSpansSlash_MatchesMultiSegmentNamespace()
    {
        // namespace "acme/api" (contains slash), service "checkout"
        // identity = "acme/api/checkout"
        // pattern "acme/api/checkout" → full literal match
        var filter = ServiceFilter.Parse("acme/api/checkout");

        Assert.True(filter.IsExcluded("checkout", "acme/api"));
        Assert.False(filter.IsExcluded("checkout", "acme/web"));
        Assert.False(filter.IsExcluded("billing", "acme/api"));
    }

    [Fact]
    public void SlashedPattern_StarSpansSlash_WildcardMatchesDeepNamespace()
    {
        // "acme/*" — star spans '/', so matches "acme/api/checkout" identity
        var filter = ServiceFilter.Parse("acme/*");

        Assert.True(filter.IsExcluded("checkout", "acme/api"));   // identity = "acme/api/checkout"
        Assert.True(filter.IsExcluded("billing", "acme/web"));    // identity = "acme/web/billing"
        Assert.False(filter.IsExcluded("checkout", "other-org")); // identity = "other-org/checkout"
    }

    [Fact]
    public void SlashedPattern_StarSlashService_MatchesAcrossAllNamespaces()
    {
        // "*/checkout" matches any identity ending in "/checkout"
        var filter = ServiceFilter.Parse("*/checkout");

        Assert.True(filter.IsExcluded("checkout", "api"));          // identity = "api/checkout"
        Assert.True(filter.IsExcluded("checkout", "acme/api"));     // identity = "acme/api/checkout"
        Assert.False(filter.IsExcluded("billing", "api"));
        Assert.False(filter.IsExcluded("checkout", null));           // identity = "checkout" — no slash, "*/checkout" won't match
    }

    [Fact]
    public void SlashedPattern_GlobWildcard_ExcludesMatchingNamespaceAndService()
    {
        // "org-*/gateway" matches "org-a/gateway", "org-b/gateway", etc.
        var filter = ServiceFilter.Parse("org-*/gateway");

        Assert.True(filter.IsExcluded("gateway", "org-a"));
        Assert.True(filter.IsExcluded("gateway", "org-b"));
        Assert.False(filter.IsExcluded("gateway", "other-org"));
        Assert.False(filter.IsExcluded("billing", "org-a"));
    }

    // ── Multi-pattern CSV ─────────────────────────────────────────────────────

    [Fact]
    public void MultiPattern_ExcludesAnyMatchingPattern()
    {
        var filter = ServiceFilter.Parse("checkout,org-a/gateway");

        Assert.True(filter.IsExcluded("checkout", "any-ns"));
        Assert.True(filter.IsExcluded("gateway", "org-a"));
        Assert.False(filter.IsExcluded("gateway", "org-b"));
        Assert.False(filter.IsExcluded("billing", null));
    }

    [Fact]
    public void Parse_CsvWithSpaces_TrimsEntries()
    {
        var filter = ServiceFilter.Parse(" checkout , billing ");

        Assert.True(filter.IsExcluded("checkout", null));
        Assert.True(filter.IsExcluded("billing", null));
        Assert.False(filter.IsExcluded("gateway", null));
    }

    // ── Permits wrapper ───────────────────────────────────────────────────────

    [Fact]
    public void Permits_ReturnsFalseForExcluded()
    {
        var filter = ServiceFilter.Parse("checkout");

        Assert.False(filter.Permits("checkout", "ns"));
        Assert.True(filter.Permits("billing", "ns"));
    }

    // ── Null namespace ────────────────────────────────────────────────────────

    [Fact]
    public void IsExcluded_NullNamespace_SlashlessPattern_Matches()
    {
        // Slashless "checkout" → matched against service only; namespace irrelevant.
        var filter = ServiceFilter.Parse("checkout");

        Assert.True(filter.IsExcluded("checkout", null));
    }

    [Fact]
    public void IsExcluded_NullNamespace_SlashedPattern_DoesNotMatch()
    {
        // "org-a/gateway" is a slashed pattern; identity for null namespace = "gateway" (no slash).
        // "org-a/gateway" won't match the identity "gateway".
        var filter = ServiceFilter.Parse("org-a/gateway");

        Assert.False(filter.IsExcluded("gateway", null));
        Assert.True(filter.IsExcluded("gateway", "org-a"));
    }

    // ── Empty SERVICE_EXCLUDE → all events pass ───────────────────────────────

    [Fact]
    public void EmptyExclude_NothingIsExcluded()
    {
        var filter = ServiceFilter.Parse(null);

        Assert.False(filter.IsExcluded("checkout", null));
        Assert.False(filter.IsExcluded("checkout", "acme/api"));
        Assert.True(filter.Permits("checkout", "ns"));
    }
}
