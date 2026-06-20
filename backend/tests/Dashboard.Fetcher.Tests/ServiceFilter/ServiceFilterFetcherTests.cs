using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Configuration;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Tests.ServiceFiltering;

/// <summary>
/// Tests that the fetcher correctly parses SERVICE_INCLUDE/EXCLUDE/REPO_INCLUDE/REPO_EXCLUDE
/// env vars into GithubAdapterOptions and that the resulting ServiceFilter blocks/passes
/// events at poll time.
/// No mocks — all real implementations.
/// </summary>
public sealed class ServiceFilterFetcherTests
{
    // ── GithubAdapterOptionsEnv wires the four filter keys ─────────────────────

    [Fact]
    public void ServiceInclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["SERVICE_INCLUDE"] = "checkout,billing" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("checkout,billing", options.ServiceInclude);
    }

    [Fact]
    public void ServiceExclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["SERVICE_EXCLUDE"] = "legacy-*" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("legacy-*", options.ServiceExclude);
    }

    [Fact]
    public void RepoInclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["REPO_INCLUDE"] = "acme/api" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("acme/api", options.RepoInclude);
    }

    [Fact]
    public void RepoExclude_BoundFromEnv_WhenPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["REPO_EXCLUDE"] = "acme/legacy" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("acme/legacy", options.RepoExclude);
    }

    [Fact]
    public void AllFilterKeys_KeepDefaults_WhenAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.ServiceInclude);
        Assert.Equal("", options.ServiceExclude);
        Assert.Equal("", options.RepoInclude);
        Assert.Equal("", options.RepoExclude);
    }

    // ── BuildServiceFilter produces correct ServiceFilter ─────────────────────

    [Fact]
    public void BuildServiceFilter_AllEmpty_ProducesPassAllFilter()
    {
        var options = new GithubAdapterOptions();
        var filter = options.BuildServiceFilter();

        Assert.True(filter.Permits("any-service", "any-namespace", "any/repo"));
    }

    [Fact]
    public void BuildServiceFilter_ServiceInclude_OnlyAllowsMatchingService()
    {
        var options = new GithubAdapterOptions { ServiceInclude = "checkout" };
        var filter = options.BuildServiceFilter();

        Assert.True(filter.Permits("checkout", "ns", "acme/api"));
        Assert.False(filter.Permits("billing", "ns", "acme/api"));
    }

    [Fact]
    public void BuildServiceFilter_ServiceExclude_BlocksMatchingService()
    {
        var options = new GithubAdapterOptions { ServiceExclude = "legacy-*" };
        var filter = options.BuildServiceFilter();

        Assert.False(filter.Permits("legacy-crm", "ns", "acme/api"));
        Assert.True(filter.Permits("checkout", "ns", "acme/api"));
    }

    [Fact]
    public void BuildServiceFilter_RepoInclude_OnlyAllowsMatchingOwnerRepo()
    {
        var options = new GithubAdapterOptions { RepoInclude = "acme/api" };
        var filter = options.BuildServiceFilter();

        Assert.True(filter.Permits("svc", "api", "acme/api"));
        Assert.False(filter.Permits("svc", "web", "acme/web"));
    }

    [Fact]
    public void BuildServiceFilter_RepoExclude_BlocksMatchingOwnerRepo()
    {
        var options = new GithubAdapterOptions { RepoExclude = "acme/legacy" };
        var filter = options.BuildServiceFilter();

        Assert.False(filter.Permits("svc", "legacy", "acme/legacy"));
        Assert.True(filter.Permits("svc", "api", "acme/api"));
    }

    // ── Filter skip semantics: fetcher overload Permits(service, namespace, ownerRepo) ──

    [Fact]
    public void FetcherFilter_AllowsWhenNoFiltersSet()
    {
        var filter = ServiceFilter.Parse(null, null, null, null);

        Assert.True(filter.Permits("checkout", "api-repo", "acme/api-repo"));
    }

    [Fact]
    public void FetcherFilter_RejectsWhenServiceNotInInclude()
    {
        var filter = ServiceFilter.Parse("allowed-svc", null, null, null);

        Assert.False(filter.Permits("blocked-svc", "ns", "acme/repo"));
        Assert.True(filter.Permits("allowed-svc", "ns", "acme/repo"));
    }

    [Fact]
    public void FetcherFilter_RejectsWhenRepoNotInInclude()
    {
        var filter = ServiceFilter.Parse(null, null, "acme/included-repo", null);

        Assert.False(filter.Permits("svc", "excluded-repo", "acme/excluded-repo"));
        Assert.True(filter.Permits("svc", "included-repo", "acme/included-repo"));
    }

    [Fact]
    public void FetcherFilter_RejectsWhenServiceInExclude_EvenIfAlsoInInclude()
    {
        // Exclude wins over include.
        var filter = ServiceFilter.Parse("checkout", "checkout", null, null);

        Assert.False(filter.Permits("checkout", "ns", "acme/repo"));
    }

    [Fact]
    public void FetcherFilter_RejectsWhenRepoInExclude()
    {
        var filter = ServiceFilter.Parse(null, null, null, "acme/excluded-repo");

        Assert.False(filter.Permits("svc", "excluded-repo", "acme/excluded-repo"));
        Assert.True(filter.Permits("svc", "other-repo", "acme/other-repo"));
    }

    [Fact]
    public void FetcherFilter_ServiceOrRepoInclude_PassesWhenEitherMatches()
    {
        // Passes when service matches SERVICE_INCLUDE even if REPO_INCLUDE doesn't match.
        var filter = ServiceFilter.Parse("checkout", null, "acme/billing-repo", null);

        // Service matches but repo doesn't match REPO_INCLUDE.
        Assert.True(filter.Permits("checkout", "api-repo", "acme/api-repo"));
        // Repo matches but service doesn't match SERVICE_INCLUDE.
        Assert.True(filter.Permits("billing", "billing-repo", "acme/billing-repo"));
        // Neither matches → blocked.
        Assert.False(filter.Permits("gateway", "api-repo", "acme/api-repo"));
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
