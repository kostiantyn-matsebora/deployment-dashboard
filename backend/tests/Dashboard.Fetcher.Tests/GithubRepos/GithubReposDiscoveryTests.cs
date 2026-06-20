using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.GithubRepos;

/// <summary>
/// Tests for GITHUB_REPOS glob expansion logic:
/// <list type="bullet">
///   <item><see cref="GithubClient.ListReposAsync"/> — discovery via GitHub REST API.</item>
///   <item><see cref="GithubAdapterOptions.RepoSpecs"/> / <see cref="GithubAdapterOptions.RepoList"/> — derived helpers.</item>
///   <item>Glob filtering of discovered repos using <see cref="ServiceFilter.GlobMatch"/>.</item>
///   <item>Empty GITHUB_REPOS = no repos, NOT *.</item>
/// </list>
/// No mocks — real implementations, fake HTTP handlers.
/// </summary>
public sealed class GithubReposDiscoveryTests
{
    // ── GithubAdapterOptions.RepoSpecs / RepoList ─────────────────────────────

    [Fact]
    public void RepoSpecs_EmptyRepos_ReturnsEmptyList()
    {
        var options = new GithubAdapterOptions { Repos = "" };

        Assert.Empty(options.RepoSpecs);
        Assert.Empty(options.RepoList);
    }

    [Fact]
    public void RepoSpecs_WhitespaceOnlyRepos_ReturnsEmptyList()
    {
        var options = new GithubAdapterOptions { Repos = "   " };

        Assert.Empty(options.RepoSpecs);
    }

    [Fact]
    public void RepoSpecs_ExactSpecs_ReturnedAsIs()
    {
        var options = new GithubAdapterOptions { Repos = "acme/api,acme/web" };

        Assert.Equal(2, options.RepoSpecs.Count);
        Assert.Contains("acme/api", options.RepoSpecs);
        Assert.Contains("acme/web", options.RepoSpecs);
    }

    [Fact]
    public void RepoList_ExcludesGlobSpecs()
    {
        var options = new GithubAdapterOptions { Repos = "acme/api,acme/*,*" };

        // Only exact specs (no '*') appear in RepoList.
        Assert.Single(options.RepoList);
        Assert.Contains("acme/api", options.RepoList);
    }

    [Fact]
    public void RepoSpecs_IncludesGlobSpecs()
    {
        var options = new GithubAdapterOptions { Repos = "acme/api,acme/*,*" };

        Assert.Equal(3, options.RepoSpecs.Count);
        Assert.Contains("acme/*", options.RepoSpecs);
        Assert.Contains("*", options.RepoSpecs);
    }

    [Fact]
    public void RepoSpecs_TrimsWhitespace()
    {
        var options = new GithubAdapterOptions { Repos = " acme/api , acme/* " };

        Assert.Equal(2, options.RepoSpecs.Count);
        Assert.Contains("acme/api", options.RepoSpecs);
        Assert.Contains("acme/*", options.RepoSpecs);
    }

    // ── GithubClient.ListReposAsync — /user/repos (no owner) ─────────────────

    [Fact]
    public async Task ListReposAsync_NoOwner_CallsUserReposEndpoint()
    {
        var repos = new[] { "acme/api", "acme/web", "org-b/service" };
        var handler = new FakeRepoListHandler("/user/repos", repos);
        var (client, http) = BuildClient(handler);
        using var _ = http;

        var result = await client.ListReposAsync(owner: null, CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Contains("acme/api", result);
        Assert.Contains("acme/web", result);
        Assert.Contains("org-b/service", result);
    }

    [Fact]
    public async Task ListReposAsync_NoOwner_EmptyResponse_ReturnsEmpty()
    {
        var handler = new FakeRepoListHandler("/user/repos", []);
        var (client, http) = BuildClient(handler);
        using var _ = http;

        var result = await client.ListReposAsync(owner: null, CancellationToken.None);

        Assert.Empty(result);
    }

    // ── GithubClient.ListReposAsync — /orgs/{owner}/repos ────────────────────

    [Fact]
    public async Task ListReposAsync_OrgOwner_CallsOrgsEndpoint()
    {
        var repos = new[] { "acme/api", "acme/web" };
        // When org endpoint returns repos, we get them without falling back to /users/.
        var handler = new FakeRepoListHandler("/orgs/acme/repos", repos);
        var (client, http) = BuildClient(handler);
        using var _ = http;

        var result = await client.ListReposAsync(owner: "acme", CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Contains("acme/api", result);
        Assert.Contains("acme/web", result);
    }

    [Fact]
    public async Task ListReposAsync_OrgOwner_NotFound_FallsBackToUserRepos()
    {
        // /orgs/bob/repos returns 404 (bob is not an org) → falls back to /users/bob/repos.
        var repos = new[] { "bob/project-a", "bob/project-b" };
        var handler = new FakeRepoListHandler(
            primaryPath: "/orgs/bob/repos",
            primaryRepos: [],
            primaryStatus: HttpStatusCode.NotFound,   // 404 = not an org → fall back
            fallbackPath: "/users/bob/repos",
            fallbackRepos: repos);
        var (client, http) = BuildClient(handler);
        using var _ = http;

        var result = await client.ListReposAsync(owner: "bob", CancellationToken.None);

        Assert.Equal(2, result.Count);
        Assert.Contains("bob/project-a", result);
        Assert.Contains("bob/project-b", result);
    }

    [Fact]
    public async Task ListReposAsync_OrgOwner_EmptyOrg_ReturnsEmptyWithoutFallingBack()
    {
        // /orgs/acme/repos returns 200 + [] (org exists, zero repos).
        // Must NOT fall back to /users/acme/repos — a 200 is authoritative.
        var userRepos = new[] { "acme/unrelated" };
        var handler = new FakeRepoListHandler(
            primaryPath: "/orgs/acme/repos",
            primaryRepos: [],
            primaryStatus: HttpStatusCode.OK,         // 200 + [] = empty org, no fallback
            fallbackPath: "/users/acme/repos",
            fallbackRepos: userRepos);
        var (client, http) = BuildClient(handler);
        using var _ = http;

        var result = await client.ListReposAsync(owner: "acme", CancellationToken.None);

        Assert.Empty(result);
    }

    // ── Glob filtering applied after discovery ────────────────────────────────

    [Fact]
    public void GlobMatch_OwnerWildcard_MatchesAllReposForOwner()
    {
        // After discovery, we filter discovered repos with ServiceFilter.GlobMatch.
        // "acme/*" should match "acme/api" and "acme/web" but not "org-b/service".
        Assert.True(ServiceFilter.GlobMatch("acme/*", "acme/api"));
        Assert.True(ServiceFilter.GlobMatch("acme/*", "acme/web"));
        Assert.False(ServiceFilter.GlobMatch("acme/*", "org-b/service"));
    }

    [Fact]
    public void GlobMatch_BareWildcard_MatchesAllRepos()
    {
        // "*" matches any "owner/repo" string.
        Assert.True(ServiceFilter.GlobMatch("*", "acme/api"));
        Assert.True(ServiceFilter.GlobMatch("*", "org-b/service"));
        Assert.True(ServiceFilter.GlobMatch("*", "any/repo"));
    }

    [Fact]
    public void GlobMatch_ExactSpec_OnlyMatchesExactString()
    {
        Assert.True(ServiceFilter.GlobMatch("acme/api", "acme/api"));
        Assert.False(ServiceFilter.GlobMatch("acme/api", "acme/web"));
        Assert.False(ServiceFilter.GlobMatch("acme/api", "org-b/api"));
    }

    // ── Empty GITHUB_REPOS = no repos (NOT *) ────────────────────────────────

    [Fact]
    public void EmptyRepos_RepoSpecsIsEmpty_MeansNoPollingShouldHappen()
    {
        var options = new GithubAdapterOptions { Repos = "" };

        // An empty RepoSpecs means no repos are polled — NOT a wildcard that expands to all.
        Assert.Empty(options.RepoSpecs);
        Assert.Empty(options.RepoList);

        // Verify that no spec contains '*' (no glob expansion triggered).
        Assert.False(options.RepoSpecs.Any(s => s.Contains('*')));
    }

    [Fact]
    public void ExactRepo_NoGlobInSpecs_DirectlyInRepoList()
    {
        // A pure "owner/repo" list never triggers discovery.
        var options = new GithubAdapterOptions { Repos = "acme/api,acme/web" };

        Assert.False(options.RepoSpecs.Any(s => s.Contains('*')));
        Assert.Equal(2, options.RepoList.Count);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static (GithubClient Client, HttpClient Http) BuildClient(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var budget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();
        return (new GithubClient(httpClient, budget), httpClient);
    }

    // ── Fake HTTP handler ─────────────────────────────────────────────────────

    /// <summary>
    /// Returns a JSON array of GhRepoItem objects at the configured path.
    /// Supports an optional fallback path (for org → user fallback).
    /// <paramref name="primaryStatus"/> overrides the primary path's HTTP status code —
    /// use <see cref="HttpStatusCode.NotFound"/> to simulate a non-org owner, or
    /// <see cref="HttpStatusCode.OK"/> (default) for an empty or populated org.
    /// Any path not matching primary or fallback returns 404.
    /// </summary>
    private sealed class FakeRepoListHandler(
        string primaryPath,
        IReadOnlyList<string> primaryRepos,
        HttpStatusCode primaryStatus = HttpStatusCode.OK,
        string? fallbackPath = null,
        IReadOnlyList<string>? fallbackRepos = null) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? "";

            if (path.StartsWith(primaryPath, StringComparison.OrdinalIgnoreCase))
            {
                if (primaryStatus != HttpStatusCode.OK)
                    return Task.FromResult(new HttpResponseMessage(primaryStatus));

                return Task.FromResult(
                    primaryRepos.Count > 0
                        ? JsonResponse(primaryRepos)
                        : new HttpResponseMessage(HttpStatusCode.OK)
                        {
                            Content = new StringContent("[]", Encoding.UTF8, "application/json"),
                        });
            }

            if (fallbackPath is not null && fallbackRepos is not null &&
                path.StartsWith(fallbackPath, StringComparison.OrdinalIgnoreCase))
            {
                return Task.FromResult(
                    fallbackRepos.Count > 0
                        ? JsonResponse(fallbackRepos)
                        : new HttpResponseMessage(HttpStatusCode.OK)
                        {
                            Content = new StringContent("[]", Encoding.UTF8, "application/json"),
                        });
            }

            // Also handle /rate_limit for RateLimitBudget.CreateAsync discovery.
            if (path.Equals("/rate_limit", StringComparison.OrdinalIgnoreCase))
            {
                var rateLimitJson = """
                    {"resources":{"core":{"limit":5000,"remaining":4900,"used":100,"reset":9999999999}}}
                    """;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(rateLimitJson, Encoding.UTF8, "application/json"),
                });
            }

            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }

        private static HttpResponseMessage JsonResponse(IReadOnlyList<string> fullNames)
        {
            var items = fullNames.Select(n => new { full_name = n }).ToArray();
            var json = JsonSerializer.Serialize(items);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json"),
            };
        }
    }
}
