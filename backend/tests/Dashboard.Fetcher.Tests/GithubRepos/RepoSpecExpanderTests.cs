using Dashboard.Fetcher.GitHub;

namespace Dashboard.Fetcher.Tests.GithubRepos;

/// <summary>
/// Unit tests for <see cref="RepoSpecExpander.ExpandAsync"/>.
/// All cases use a real lister delegate (no mocks); the delegate is a simple in-memory
/// function that returns a preset list of repos.
/// </summary>
public sealed class RepoSpecExpanderTests
{
    // ── Exact repo passthrough ────────────────────────────────────────────────

    [Fact]
    public async Task ExpandAsync_ExactSpecs_ReturnedWithoutCallingLister()
    {
        var listerCalled = false;
        Task<IReadOnlyList<string>> Lister(string? owner, CancellationToken ct)
        {
            listerCalled = true;
            return Task.FromResult<IReadOnlyList<string>>([]);
        }

        var result = await RepoSpecExpander.ExpandAsync(
            ["acme/api", "acme/web"],
            Lister,
            CancellationToken.None);

        Assert.False(listerCalled, "Lister must NOT be called when no spec contains '*'.");
        Assert.Equal(2, result.Count);
        Assert.Contains("acme/api", result);
        Assert.Contains("acme/web", result);
    }

    [Fact]
    public async Task ExpandAsync_ExactSpecs_DuplicatesDeduped()
    {
        var result = await RepoSpecExpander.ExpandAsync(
            ["acme/api", "acme/api"],
            (_, _) => Task.FromResult<IReadOnlyList<string>>([]),
            CancellationToken.None);

        Assert.Single(result);
        Assert.Contains("acme/api", result);
    }

    // ── owner/* expansion ─────────────────────────────────────────────────────

    [Fact]
    public async Task ExpandAsync_OwnerWildcard_ListsOwnerReposAndFilters()
    {
        // Lister returns all repos for "acme" — expander must only include those matching "acme/*".
        var allAcmeRepos = new List<string> { "acme/api", "acme/web", "acme/cli" };

        Task<IReadOnlyList<string>> Lister(string? owner, CancellationToken ct)
        {
            Assert.Equal("acme", owner);
            return Task.FromResult<IReadOnlyList<string>>(allAcmeRepos);
        }

        var result = await RepoSpecExpander.ExpandAsync(
            ["acme/*"],
            Lister,
            CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Contains("acme/api", result);
        Assert.Contains("acme/web", result);
        Assert.Contains("acme/cli", result);
    }

    [Fact]
    public async Task ExpandAsync_OwnerWildcard_MixedWithExact_BothReturned()
    {
        var allAcmeRepos = new List<string> { "acme/api", "acme/web" };

        Task<IReadOnlyList<string>> Lister(string? owner, CancellationToken ct)
        {
            // Only called for the glob spec.
            Assert.Equal("acme", owner);
            return Task.FromResult<IReadOnlyList<string>>(allAcmeRepos);
        }

        var result = await RepoSpecExpander.ExpandAsync(
            ["other/svc", "acme/*"],
            Lister,
            CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Contains("other/svc", result);
        Assert.Contains("acme/api", result);
        Assert.Contains("acme/web", result);
    }

    // ── bare * expansion ──────────────────────────────────────────────────────

    [Fact]
    public async Task ExpandAsync_BareWildcard_ListsAllReposWithNullOwner()
    {
        var allRepos = new List<string> { "acme/api", "org-b/service", "solo/tool" };

        Task<IReadOnlyList<string>> Lister(string? owner, CancellationToken ct)
        {
            Assert.Null(owner);   // bare * → owner is null
            return Task.FromResult<IReadOnlyList<string>>(allRepos);
        }

        var result = await RepoSpecExpander.ExpandAsync(
            ["*"],
            Lister,
            CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Contains("acme/api", result);
        Assert.Contains("org-b/service", result);
        Assert.Contains("solo/tool", result);
    }

    [Fact]
    public async Task ExpandAsync_BareWildcard_GlobMatchFiltersOut_NothingExcluded()
    {
        // Every discovered repo must match "*" (wildcard matches all).
        var allRepos = new List<string> { "x/y", "a/b/c-looking-string" };

        var result = await RepoSpecExpander.ExpandAsync(
            ["*"],
            (_, _) => Task.FromResult<IReadOnlyList<string>>(allRepos),
            CancellationToken.None);

        Assert.Equal(2, result.Count);
    }

    // ── empty GITHUB_REPOS ────────────────────────────────────────────────────

    [Fact]
    public async Task ExpandAsync_EmptySpecs_ReturnsEmptyWithoutCallingLister()
    {
        var listerCalled = false;
        Task<IReadOnlyList<string>> Lister(string? owner, CancellationToken ct)
        {
            listerCalled = true;
            return Task.FromResult<IReadOnlyList<string>>([]);
        }

        var result = await RepoSpecExpander.ExpandAsync([], Lister, CancellationToken.None);

        Assert.Empty(result);
        Assert.False(listerCalled, "Lister must NOT be called for an empty spec list.");
    }
}
