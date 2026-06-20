using Dashboard.Shared.ServiceFiltering;

namespace Dashboard.Shared.Tests.ServiceFiltering;

/// <summary>
/// Unit tests for <see cref="ServiceFilter"/> covering glob matching, precedence,
/// empty defaults, SERVICE vs REPO pattern semantics, and the two Permits overloads.
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

    // ── Empty defaults ────────────────────────────────────────────────────────

    [Fact]
    public void PassAll_PermitsAnyServiceAndNamespace()
    {
        var filter = ServiceFilter.PassAll;

        Assert.True(filter.Permits("any-service", "any-namespace"));
        Assert.True(filter.Permits("my-api", null));
    }

    [Fact]
    public void ParseAllEmpty_PermitsEverything()
    {
        var filter = ServiceFilter.Parse(null, null, null, null);

        Assert.True(filter.Permits("svc", "ns"));
        Assert.True(filter.Permits("svc", null));
    }

    [Fact]
    public void EmptyInclude_MatchesAll()
    {
        // No SERVICE_INCLUDE or REPO_INCLUDE → include everything.
        var filter = ServiceFilter.Parse(null, null, null, null);

        Assert.True(filter.Permits("checkout", "my-repo"));
        Assert.True(filter.Permits("billing", null));
    }

    [Fact]
    public void EmptyExclude_ExcludesNothing()
    {
        // SERVICE_INCLUDE is set but SERVICE_EXCLUDE is empty → only include applies.
        var filter = ServiceFilter.Parse("checkout", null, null, null);

        Assert.True(filter.Permits("checkout", "ns"));
        Assert.False(filter.Permits("billing", "ns")); // not in include
    }

    // ── SERVICE_INCLUDE / SERVICE_EXCLUDE ─────────────────────────────────────

    [Fact]
    public void ServiceInclude_AllowsOnlyMatchingServices()
    {
        var filter = ServiceFilter.Parse("checkout,billing", null, null, null);

        Assert.True(filter.Permits("checkout", "ns"));
        Assert.True(filter.Permits("billing", "ns"));
        Assert.False(filter.Permits("gateway", "ns"));
    }

    [Fact]
    public void ServiceExclude_BlocksMatchingServices()
    {
        var filter = ServiceFilter.Parse(null, "checkout", null, null);

        Assert.False(filter.Permits("checkout", "ns"));
        Assert.True(filter.Permits("billing", "ns"));
    }

    [Fact]
    public void ExcludeWinsOverInclude_WhenBothMatch()
    {
        // Same service in both include and exclude → exclude wins.
        var filter = ServiceFilter.Parse("checkout", "checkout", null, null);

        Assert.False(filter.Permits("checkout", "ns"));
    }

    [Fact]
    public void ServiceInclude_GlobPattern_Wildcard()
    {
        var filter = ServiceFilter.Parse("api-*", null, null, null);

        Assert.True(filter.Permits("api-gateway", "ns"));
        Assert.True(filter.Permits("api-auth", "ns"));
        Assert.False(filter.Permits("frontend", "ns"));
    }

    [Fact]
    public void ServiceInclude_SlashPattern_MatchesComposite()
    {
        // A SERVICE pattern with '/' matches namespace/service composite.
        var filter = ServiceFilter.Parse("org-a/gateway", null, null, null);

        Assert.True(filter.Permits("gateway", "org-a"));
        Assert.False(filter.Permits("gateway", "org-b"));
        Assert.False(filter.Permits("gateway", null));
    }

    [Fact]
    public void ServiceInclude_NoSlashPattern_MatchesServiceAcrossAllNamespaces()
    {
        // A pattern without '/' matches the service name across all namespaces.
        var filter = ServiceFilter.Parse("gateway", null, null, null);

        Assert.True(filter.Permits("gateway", "org-a"));
        Assert.True(filter.Permits("gateway", "org-b"));
        Assert.True(filter.Permits("gateway", null));
    }

    [Fact]
    public void ServiceExclude_SlashPattern_BlocksOnlyMatchingComposite()
    {
        var filter = ServiceFilter.Parse(null, "org-a/gateway", null, null);

        Assert.False(filter.Permits("gateway", "org-a"));
        Assert.True(filter.Permits("gateway", "org-b")); // different namespace not blocked
        Assert.True(filter.Permits("other", "org-a"));
    }

    // ── REPO_INCLUDE / REPO_EXCLUDE (read-API overload) ──────────────────────

    [Fact]
    public void RepoInclude_ReadApi_MatchesNamespaceViaNameSegment()
    {
        // REPO_INCLUDE pattern name segment matched against namespace.
        var filter = ServiceFilter.Parse(null, null, "acme/my-api", null);

        Assert.True(filter.Permits("svc", "my-api"));
        Assert.False(filter.Permits("svc", "other-repo"));
        Assert.False(filter.Permits("svc", null));
    }

    [Fact]
    public void RepoExclude_ReadApi_BlocksMatchingNamespace()
    {
        var filter = ServiceFilter.Parse(null, null, null, "acme/my-api");

        Assert.False(filter.Permits("svc", "my-api"));
        Assert.True(filter.Permits("svc", "other-repo"));
    }

    [Fact]
    public void RepoInclude_ReadApi_GlobInNameSegment()
    {
        var filter = ServiceFilter.Parse(null, null, "acme/*-api", null);

        Assert.True(filter.Permits("svc", "my-api"));
        Assert.True(filter.Permits("svc", "billing-api"));
        Assert.False(filter.Permits("svc", "frontend"));
    }

    [Fact]
    public void RepoInclude_ReadApi_NoSlashPattern_MatchesNamespaceDirectly()
    {
        // REPO_INCLUDE pattern without '/' → name segment = whole pattern → direct namespace match.
        var filter = ServiceFilter.Parse(null, null, "my-api", null);

        Assert.True(filter.Permits("svc", "my-api"));
        Assert.False(filter.Permits("svc", "other-repo"));
    }

    // ── REPO_INCLUDE / REPO_EXCLUDE (fetcher overload: full owner/repo) ───────

    [Fact]
    public void RepoInclude_Fetcher_MatchesFullOwnerRepo()
    {
        var filter = ServiceFilter.Parse(null, null, "acme/my-api", null);

        Assert.True(filter.Permits("svc", "my-api", "acme/my-api"));
        Assert.False(filter.Permits("svc", "other-repo", "acme/other-repo"));
    }

    [Fact]
    public void RepoExclude_Fetcher_BlocksMatchingOwnerRepo()
    {
        var filter = ServiceFilter.Parse(null, null, null, "acme/my-api");

        Assert.False(filter.Permits("svc", "my-api", "acme/my-api"));
        Assert.True(filter.Permits("svc", "other-repo", "acme/other-repo"));
    }

    [Fact]
    public void RepoInclude_Fetcher_GlobPattern()
    {
        var filter = ServiceFilter.Parse(null, null, "acme/*", null);

        Assert.True(filter.Permits("svc", "my-api", "acme/my-api"));
        Assert.True(filter.Permits("svc", "billing", "acme/billing"));
        Assert.False(filter.Permits("svc", "my-api", "other-org/my-api"));
    }

    // ── Combined include rules (SERVICE OR REPO grants include) ───────────────

    [Fact]
    public void ServiceOrRepoInclude_PassesWhenEitherMatches()
    {
        // Effective rule: passes if SERVICE_INCLUDE OR REPO_INCLUDE matches (before exclude).
        var filter = ServiceFilter.Parse("checkout", null, "acme/billing-repo", null);

        Assert.True(filter.Permits("checkout", "unrelated-repo")); // service matches
        Assert.True(filter.Permits("billing", "billing-repo"));    // repo matches (name segment)
        Assert.False(filter.Permits("gateway", "unrelated-repo")); // neither matches
    }

    // ── Parse CSV ─────────────────────────────────────────────────────────────

    [Fact]
    public void Parse_CsvWithSpaces_TrimsEntries()
    {
        var filter = ServiceFilter.Parse(" checkout , billing ", null, null, null);

        Assert.True(filter.Permits("checkout", "ns"));
        Assert.True(filter.Permits("billing", "ns"));
        Assert.False(filter.Permits("gateway", "ns"));
    }

    [Fact]
    public void Parse_EmptyString_TreatedAsEmptyList()
    {
        var filter = ServiceFilter.Parse("", "", "", "");

        // All lists empty → pass-all.
        Assert.True(filter.Permits("anything", "anywhere"));
    }

    [Fact]
    public void Parse_WhitespaceOnlyCsv_TreatedAsEmpty()
    {
        var filter = ServiceFilter.Parse("   ", null, null, null);

        Assert.True(filter.Permits("any-svc", "any-ns"));
    }

    // ── Full EFFECTIVE RULE matrix ────────────────────────────────────────────

    [Theory]
    [InlineData("", "", "", "", "svc", "ns", true)]          // all empty → pass
    [InlineData("svc", "", "", "", "svc", "ns", true)]       // include matches
    [InlineData("svc", "", "", "", "other", "ns", false)]    // include set, no match
    [InlineData("", "svc", "", "", "svc", "ns", false)]      // exclude matches
    [InlineData("", "svc", "", "", "other", "ns", true)]     // exclude set, no match
    [InlineData("svc", "svc", "", "", "svc", "ns", false)]   // both match → exclude wins
    public void EffectiveRule_Matrix(
        string svcInclude, string svcExclude, string repoInclude, string repoExclude,
        string service, string @namespace, bool expected)
    {
        var filter = ServiceFilter.Parse(
            string.IsNullOrEmpty(svcInclude) ? null : svcInclude,
            string.IsNullOrEmpty(svcExclude) ? null : svcExclude,
            string.IsNullOrEmpty(repoInclude) ? null : repoInclude,
            string.IsNullOrEmpty(repoExclude) ? null : repoExclude);

        Assert.Equal(expected, filter.Permits(service, @namespace));
    }
}
