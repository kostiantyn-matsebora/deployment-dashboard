using System.Net;
using System.Text;
using System.Text.Json;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Models;
using Dashboard.Fetcher.GitHub.RateLimit;
using Microsoft.Extensions.Logging.Abstractions;

namespace Dashboard.Fetcher.Tests.Graph;

/// <summary>
/// Regression tests for run-conclusion freshness in <see cref="WorkflowGraphCache"/> (#268 follow-up).
/// A workflow run's identity fields are immutable, but its <c>conclusion</c> is null while the run is
/// in flight and only set once it completes. Status refinement reads <c>conclusion</c> to turn a
/// <c>failure</c> into <c>cancelled</c>, so a run cached mid-flight MUST be re-fetched — otherwise a
/// later cancellation is missed. Completed runs stay cached (no redundant calls on repeat polls).
/// </summary>
public sealed class WorkflowRunCacheStalenessTests
{
    private const string Owner = "acme";
    private const string Repo = "api";
    private const long RunId = 777L;

    [Fact]
    public async Task GetOrFetchRun_CachedWhileInFlight_RefetchesUntilConclusionPresent()
    {
        // 1st fetch: run still in flight (conclusion null). 2nd: completed as cancelled.
        var handler = new SequencedRunHandler(RunId,
        [
            new GhWorkflowRun { Id = RunId, Name = "Deploy", Path = ".github/workflows/d.yml", HeadSha = "abc", Conclusion = null },
            new GhWorkflowRun { Id = RunId, Name = "Deploy", Path = ".github/workflows/d.yml", HeadSha = "abc", Conclusion = "cancelled" },
        ]);
        var (cache, client) = Build(handler);

        var first = await cache.GetOrFetchRunAsync(Owner, Repo, RunId, client, default);
        var second = await cache.GetOrFetchRunAsync(Owner, Repo, RunId, client, default);

        Assert.Null(first?.Conclusion);
        Assert.Equal("cancelled", second?.Conclusion); // re-fetched, not served stale-null
        Assert.Equal(2, handler.RunCallCount);
    }

    [Fact]
    public async Task GetOrFetchRun_CachedAfterCompletion_DoesNotRefetch()
    {
        // 1st fetch: already complete. A 2nd fetch must NOT happen (the sentinel would surface a bug).
        var handler = new SequencedRunHandler(RunId,
        [
            new GhWorkflowRun { Id = RunId, Name = "Deploy", Path = ".github/workflows/d.yml", HeadSha = "abc", Conclusion = "success" },
            new GhWorkflowRun { Id = RunId, Name = "Deploy", Path = ".github/workflows/d.yml", HeadSha = "abc", Conclusion = "unexpected-refetch" },
        ]);
        var (cache, client) = Build(handler);

        var first = await cache.GetOrFetchRunAsync(Owner, Repo, RunId, client, default);
        var second = await cache.GetOrFetchRunAsync(Owner, Repo, RunId, client, default);

        Assert.Equal("success", first?.Conclusion);
        Assert.Equal("success", second?.Conclusion); // served from cache — completed runs are immutable
        Assert.Equal(1, handler.RunCallCount);
    }

    private static (WorkflowGraphCache Cache, GithubClient Client) Build(HttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler) { BaseAddress = new Uri("https://api.github.com") };
        var budget = RateLimitBudget.CreateAsync(
            httpClient, configuredLimit: 5000, budgetPct: 100,
            NullLogger<RateLimitBudget>.Instance, default).GetAwaiter().GetResult();
        return (new WorkflowGraphCache(), new GithubClient(httpClient, budget));
    }

    /// <summary>Serves a sequence of run payloads for the run endpoint and counts the calls.</summary>
    private sealed class SequencedRunHandler(long runId, IReadOnlyList<GhWorkflowRun> sequence)
        : HttpMessageHandler
    {
        private readonly string _runPath = $"/repos/{Owner}/{Repo}/actions/runs/{runId}";
        private int _index;
        public int RunCallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            if ((request.RequestUri?.AbsolutePath ?? "") == _runPath)
            {
                var payload = sequence[Math.Min(_index, sequence.Count - 1)];
                _index++;
                RunCallCount++;
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
                });
            }
            // Everything else (incl. /rate_limit) → 404; budget falls back to the configured limit.
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
