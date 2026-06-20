using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Configuration;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Tests.ServiceFiltering;

/// <summary>
/// Tests that the fetcher correctly parses the <c>SERVICE_EXCLUDE</c> env var into
/// <see cref="GithubAdapterOptions"/> and that the resulting <see cref="ServiceFilter"/>
/// blocks/passes services at poll time using the three-argument fetcher overload.
/// No mocks — all real implementations.
/// </summary>
public sealed class ServiceFilterFetcherTests
{
    // ── GithubAdapterOptionsEnv wires SERVICE_EXCLUDE ──────────────────────────

    [Fact]
    public void ServiceExclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["SERVICE_EXCLUDE"] = "acme/*/legacy-*" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("acme/*/legacy-*", options.ServiceExclude);
    }

    [Fact]
    public void ServiceExclude_KeepsDefault_WhenAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.ServiceExclude);
    }

    // ── BuildServiceFilter produces correct ServiceFilter ─────────────────────

    [Fact]
    public void BuildServiceFilter_Empty_ProducesPassAllFilter()
    {
        var options = new GithubAdapterOptions();
        var filter = options.BuildServiceFilter();

        Assert.True(filter.IsEmpty);
        Assert.True(filter.Permits("any-service", "any-namespace", "any/repo"));
    }

    [Fact]
    public void BuildServiceFilter_SingleSegment_ExcludesMatchingService()
    {
        var options = new GithubAdapterOptions { ServiceExclude = "legacy-crm" };
        var filter = options.BuildServiceFilter();

        Assert.False(filter.Permits("legacy-crm", "ns", "acme/api"));
        Assert.True(filter.Permits("checkout", "ns", "acme/api"));
    }

    [Fact]
    public void BuildServiceFilter_ThreeSegment_ExcludesMatchingTriple()
    {
        var options = new GithubAdapterOptions { ServiceExclude = "acme/web/legacy-*" };
        var filter = options.BuildServiceFilter();

        Assert.False(filter.Permits("legacy-crm", "web", "acme/web"));
        Assert.True(filter.Permits("checkout", "web", "acme/web")); // different service
        Assert.True(filter.Permits("legacy-crm", "api", "acme/api")); // different repo
        Assert.True(filter.Permits("legacy-crm", "web", "org-b/web")); // different owner
    }

    [Fact]
    public void BuildServiceFilter_MultiPattern_ExcludesAnyMatch()
    {
        var options = new GithubAdapterOptions { ServiceExclude = "acme/*/canary,*/*/legacy" };
        var filter = options.BuildServiceFilter();

        Assert.False(filter.Permits("canary", "api", "acme/api"));
        Assert.False(filter.Permits("legacy", "web", "org-b/web"));
        Assert.True(filter.Permits("checkout", "api", "acme/api"));
    }

    // ── Fetcher skip semantics: IsExcluded(owner, repo, service) ─────────────

    [Fact]
    public void FetcherFilter_Empty_AllowsEverything()
    {
        var filter = ServiceFilter.Parse(null);

        Assert.False(filter.IsExcluded("acme", "api", "checkout"));
        Assert.False(filter.IsExcluded("acme", "api", "legacy-crm"));
    }

    [Fact]
    public void FetcherFilter_OwnerWildcard_ExcludesMatchingServiceInAnyOrg()
    {
        // "*/web/checkout" → excluded regardless of owner.
        var filter = ServiceFilter.Parse("*/web/checkout");

        Assert.True(filter.IsExcluded("acme", "web", "checkout"));
        Assert.True(filter.IsExcluded("org-b", "web", "checkout"));
        Assert.False(filter.IsExcluded("acme", "api", "checkout")); // different repo
    }

    [Fact]
    public void FetcherFilter_RepoWildcard_ExcludesMatchingServiceInAnyRepo()
    {
        var filter = ServiceFilter.Parse("acme/*/internal");

        Assert.True(filter.IsExcluded("acme", "web", "internal"));
        Assert.True(filter.IsExcluded("acme", "api", "internal"));
        Assert.False(filter.IsExcluded("org-b", "web", "internal")); // wrong owner
    }

    [Fact]
    public void FetcherFilter_ServiceGlob_ExcludesMatchingServiceName()
    {
        var filter = ServiceFilter.Parse("acme/api/legacy-*");

        Assert.True(filter.IsExcluded("acme", "api", "legacy-crm"));
        Assert.True(filter.IsExcluded("acme", "api", "legacy-billing"));
        Assert.False(filter.IsExcluded("acme", "api", "checkout"));
    }

    [Fact]
    public void FetcherFilter_ExactPattern_OnlyExcludesExactMatch()
    {
        var filter = ServiceFilter.Parse("acme/api/checkout");

        Assert.True(filter.IsExcluded("acme", "api", "checkout"));
        Assert.False(filter.IsExcluded("acme", "api", "checkout-v2"));
        Assert.False(filter.IsExcluded("org-b", "api", "checkout"));
    }

    [Fact]
    public void FetcherFilter_EmptyServiceExclude_IsPassAll_NoIngestionBlocked()
    {
        // An empty SERVICE_EXCLUDE must produce IsPassAll = true and block nothing.
        var filter = ServiceFilter.Parse("");

        Assert.True(filter.IsEmpty);
        Assert.False(filter.IsExcluded("acme", "api", "any-service"));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
