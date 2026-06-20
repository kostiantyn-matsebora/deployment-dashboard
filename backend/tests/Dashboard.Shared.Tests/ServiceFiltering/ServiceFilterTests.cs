using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Shared.Tests.ServiceFiltering;

/// <summary>
/// Unit tests for <see cref="ServiceFilter"/> covering glob matching, the exclude-only design,
/// empty defaults, three-segment owner/repo/service patterns, and the two IsExcluded overloads.
/// No mocks — all real implementations.
/// </summary>
public sealed class ServiceFilterTests
{
    // ── GlobMatch ─────────────────────────────────────────────────────────────

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
    [InlineData("org-a/gateway", "org-a/gateway", true)]
    [InlineData("org-a/gateway", "org-b/gateway", false)]
    [InlineData("org-*/gateway", "org-a/gateway", true)]
    [InlineData("org-*/gateway", "org-b/gateway", true)]
    [InlineData("*/gateway", "org-a/gateway", true)]
    public void GlobMatch_VariousPatterns_MatchesExpected(string pattern, string value, bool expected)
    {
        var result = ServiceFilter.GlobMatch(pattern, value);

        Assert.Equal(expected, result);
    }

    // ── Empty defaults (pass-all) ─────────────────────────────────────────────

    [Fact]
    public void PassAll_PermitsAnyServiceAndNamespace()
    {
        var filter = ServiceFilter.PassAll;

        Assert.True(filter.Permits("any-service", "any-namespace"));
        Assert.True(filter.Permits("my-api", null));
        Assert.True(filter.IsPassAll);
        Assert.True(filter.IsEmpty);
    }

    [Fact]
    public void ParseNull_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse(null);

        Assert.True(filter.IsPassAll);
        Assert.True(filter.Permits("svc", "ns"));
        Assert.True(filter.Permits("svc", null));
    }

    [Fact]
    public void ParseEmptyString_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse("");

        Assert.True(filter.IsPassAll);
        Assert.True(filter.Permits("anything", "anywhere"));
    }

    [Fact]
    public void ParseWhitespace_ReturnsPassAll()
    {
        var filter = ServiceFilter.Parse("   ");

        Assert.True(filter.IsPassAll);
        Assert.True(filter.Permits("any-svc", "any-ns"));
    }

    // ── Single-segment pattern (wildcard owner and repo) ─────────────────────

    [Fact]
    public void SingleSegment_ExcludesMatchingServiceAcrossAllOwnersAndRepos()
    {
        // "checkout" → parsed as ["*", "*", "checkout"]
        var filter = ServiceFilter.Parse("checkout");

        Assert.True(filter.IsExcluded("checkout", "any-ns"));
        Assert.True(filter.IsExcluded("acme", "api", "checkout"));
        Assert.True(filter.IsExcluded("org-b", "web", "checkout"));
        Assert.False(filter.IsExcluded("billing", "any-ns"));
    }

    [Fact]
    public void SingleSegment_Wildcard_ExcludesEverything()
    {
        var filter = ServiceFilter.Parse("*");

        Assert.True(filter.IsExcluded("acme", "api", "any-service"));
        Assert.True(filter.IsExcluded("any-service", null));
    }

    [Fact]
    public void SingleSegment_GlobSuffix_ExcludesMatchingServices()
    {
        var filter = ServiceFilter.Parse("legacy-*");

        Assert.True(filter.IsExcluded("acme", "web", "legacy-crm"));
        Assert.True(filter.IsExcluded("legacy-payments", null));
        Assert.False(filter.IsExcluded("checkout", null));
    }

    // ── Two-segment pattern (owner wildcarded) ────────────────────────────────

    [Fact]
    public void TwoSegment_ExcludesMatchingRepoAndService()
    {
        // "my-repo/checkout" → parsed as ["*", "my-repo", "checkout"]
        var filter = ServiceFilter.Parse("my-repo/checkout");

        // Fetcher overload: any owner, repo="my-repo", service="checkout" → excluded.
        Assert.True(filter.IsExcluded("acme", "my-repo", "checkout"));
        Assert.True(filter.IsExcluded("org-b", "my-repo", "checkout"));
        // Different repo → not excluded.
        Assert.False(filter.IsExcluded("acme", "other-repo", "checkout"));
        // API overload: namespace="my-repo", service="checkout" → excluded.
        Assert.True(filter.IsExcluded("checkout", "my-repo"));
        Assert.False(filter.IsExcluded("checkout", "other-ns"));
    }

    // ── Three-segment pattern (full owner/repo/service) ───────────────────────

    [Fact]
    public void ThreeSegment_ExcludesOnlyExactMatch()
    {
        var filter = ServiceFilter.Parse("acme/web/legacy-*");

        // Fetcher overload.
        Assert.True(filter.IsExcluded("acme", "web", "legacy-crm"));
        Assert.True(filter.IsExcluded("acme", "web", "legacy-billing"));
        Assert.False(filter.IsExcluded("acme", "api", "legacy-crm")); // wrong repo
        Assert.False(filter.IsExcluded("org-b", "web", "legacy-crm")); // wrong owner
        Assert.False(filter.IsExcluded("acme", "web", "new-crm"));    // no prefix match

        // API overload: owner is wildcarded → repo/service match only.
        Assert.True(filter.IsExcluded("legacy-crm", "web"));
        Assert.False(filter.IsExcluded("legacy-crm", "api"));
    }

    [Fact]
    public void ThreeSegment_OwnerWildcard_ExcludesAcrossAllOwners()
    {
        var filter = ServiceFilter.Parse("*/api/canary");

        Assert.True(filter.IsExcluded("acme", "api", "canary"));
        Assert.True(filter.IsExcluded("org-b", "api", "canary"));
        Assert.False(filter.IsExcluded("acme", "web", "canary"));
    }

    [Fact]
    public void ThreeSegment_RepoWildcard_ExcludesAcrossAllRepos()
    {
        var filter = ServiceFilter.Parse("acme/*/internal");

        Assert.True(filter.IsExcluded("acme", "api", "internal"));
        Assert.True(filter.IsExcluded("acme", "web", "internal"));
        Assert.False(filter.IsExcluded("org-b", "api", "internal")); // wrong owner
        Assert.False(filter.IsExcluded("acme", "api", "public"));
    }

    // ── Multi-pattern CSV ─────────────────────────────────────────────────────

    [Fact]
    public void MultiPattern_ExcludesAnyMatchingPattern()
    {
        var filter = ServiceFilter.Parse("acme/web/legacy-*,acme/*/canary");

        Assert.True(filter.IsExcluded("acme", "web", "legacy-crm"));
        Assert.True(filter.IsExcluded("acme", "api", "canary"));
        Assert.False(filter.IsExcluded("acme", "web", "checkout"));
    }

    [Fact]
    public void Parse_CsvWithSpaces_TrimsEntries()
    {
        var filter = ServiceFilter.Parse(" checkout , billing ");

        Assert.True(filter.IsExcluded("checkout", null));
        Assert.True(filter.IsExcluded("billing", null));
        Assert.False(filter.IsExcluded("gateway", null));
    }

    // ── Permits wrappers ──────────────────────────────────────────────────────

    [Fact]
    public void Permits_TwoArg_ReturnsFalseForExcluded()
    {
        var filter = ServiceFilter.Parse("checkout");

        Assert.False(filter.Permits("checkout", "ns"));
        Assert.True(filter.Permits("billing", "ns"));
    }

    [Fact]
    public void Permits_ThreeArg_ReturnsFalseForExcluded()
    {
        var filter = ServiceFilter.Parse("acme/web/legacy-*");

        Assert.False(filter.Permits("legacy-crm", "web", "acme/web"));
        Assert.True(filter.Permits("checkout", "web", "acme/web"));
    }

    [Fact]
    public void Permits_ThreeArg_OwnerRepoSplit_MatchesFetcherTriple()
    {
        // Permits(service, ns, "owner/repo") delegates to IsExcluded(owner, repo, service).
        var filter = ServiceFilter.Parse("acme/api/checkout");

        Assert.False(filter.Permits("checkout", "api", "acme/api"));
        Assert.True(filter.Permits("checkout", "web", "acme/web")); // different repo
    }

    // ── IsExcluded API overload: null namespace matches empty string ───────────

    [Fact]
    public void IsExcluded_NullNamespace_MatchedAsEmpty()
    {
        // Pattern "*/*" (two segments) → [*, *, *] → should match any service/namespace including null.
        var filter = ServiceFilter.Parse("*");

        Assert.True(filter.IsExcluded("any-service", null));
    }

    [Fact]
    public void IsExcluded_LiteralPatternRepoSegment_DoesNotMatchNull()
    {
        // Pattern "my-repo/checkout" → segments[1]="my-repo". Null namespace ≠ "my-repo".
        var filter = ServiceFilter.Parse("my-repo/checkout");

        Assert.False(filter.IsExcluded("checkout", null)); // null → empty; GlobMatch("my-repo","") is false
        Assert.True(filter.IsExcluded("checkout", "my-repo"));
    }

    // ── Empty SERVICE_EXCLUDE → all events pass ────────────────────────────────

    [Fact]
    public void EmptyExclude_NothingIsExcluded()
    {
        var filter = ServiceFilter.Parse(null);

        Assert.False(filter.IsExcluded("checkout", null));
        Assert.False(filter.IsExcluded("acme", "web", "checkout"));
        Assert.True(filter.Permits("checkout", "ns"));
    }
}
