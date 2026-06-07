using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.GitHub;
using Dashboard.Shared.Contracts;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.Logging;

namespace Dashboard.Fetcher.Host.Extensions;

/// <summary>
/// Registers the singleton services required by the fetcher host (§3 solution layout).
/// </summary>
internal static class FetcherSingletonExtensions
{
    /// <summary>
    /// Adds all fetcher singleton services:
    /// <list type="bullet">
    ///   <item>Options objects, graph cache, readiness indicator.</item>
    ///   <item>Rate-limit budget (initialized synchronously from GitHub at startup).</item>
    ///   <item>GitHub client, version resolver, backfill runner, adapter.</item>
    ///   <item>PollLoop list (shared with <c>ControlStreamListener</c> for pause/resume).</item>
    /// </list>
    /// </summary>
    internal static IServiceCollection AddFetcherSingletons(
        this IServiceCollection services,
        FetcherOptions fetcherOptions,
        GithubAdapterOptions githubOptions)
    {
        services.AddSingleton(fetcherOptions);
        services.AddSingleton(githubOptions);
        services.AddSingleton<WorkflowGraphCache>();
        services.AddSingleton<FetcherReadinessIndicator>();
        services.AddSingleton<IFetcherReadinessIndicator>(
            sp => sp.GetRequiredService<FetcherReadinessIndicator>());

        services.AddSingleton<RateLimitBudget>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            var http = factory.CreateClient(FetcherConstants.GitHubHttpClientName);
            var logger = sp.GetRequiredService<ILogger<RateLimitBudget>>();
            return RateLimitBudget.CreateAsync(
                http,
                githubOptions.RateLimit,
                githubOptions.RateLimitBudgetPct,
                logger,
                CancellationToken.None).GetAwaiter().GetResult();
        });

        services.AddSingleton<GithubClient>(sp =>
        {
            var factory = sp.GetRequiredService<IHttpClientFactory>();
            var http = factory.CreateClient(FetcherConstants.GitHubHttpClientName);
            var budget = sp.GetRequiredService<RateLimitBudget>();
            return new GithubClient(http, budget);
        });

        services.AddSingleton<VersionResolver>(sp => new VersionResolver(
            VersionSourceConfig.Parse(githubOptions.VersionSource),
            sp.GetRequiredService<WorkflowGraphCache>(),
            sp.GetRequiredService<GithubClient>()));

        services.AddSingleton<GithubStatusResolver>();
        services.AddSingleton<BackfillRunner>();
        services.AddSingleton<GithubActionsAdapter>();
        services.AddSingleton<ICiCdAdapter>(sp => sp.GetRequiredService<GithubActionsAdapter>());

        // PollLoop instances are shared singletons — FetcherWorker runs them; ControlStreamListener
        // pauses/resumes them on reset events (F17).
        services.AddSingleton<IReadOnlyList<PollLoop>>(sp => BuildPollLoops(sp, fetcherOptions));

        return services;
    }

    private static IReadOnlyList<PollLoop> BuildPollLoops(
        IServiceProvider sp,
        FetcherOptions fetcherOptions)
    {
        var adapters = sp.GetRequiredService<IEnumerable<ICiCdAdapter>>();
        var ingest = sp.GetRequiredService<IIngestClient>();
        var state = sp.GetRequiredService<IFetcherStateClient>();
        var logFactory = sp.GetRequiredService<ILoggerFactory>();
        var readiness = sp.GetRequiredService<FetcherReadinessIndicator>();
        var rateLimitBudget = sp.GetRequiredService<RateLimitBudget>();
        var componentEvents = sp.GetRequiredService<IComponentEventClient>();

        // Snapshot includes ci_limit / ci_remaining for F18 (§5.11).
        Func<RateLimitSnapshot?> snapshotFactory = () =>
            new RateLimitSnapshot(
                rateLimitBudget.Used,
                rateLimitBudget.Budget,
                rateLimitBudget.ResetAt,
                rateLimitBudget.CiLimit,
                rateLimitBudget.CiRemaining);

        return adapters
            .Select(adapter =>
            {
                // Delegate closes over the adapter id so IComponentEventClient carries it
                // without changing the Orchestration → Control dependency direction (F18).
                Func<RateLimitSnapshot, CancellationToken, Task> reportCycleAsync =
                    (snapshot, ct) => componentEvents.PostRateLimitAsync(
                        snapshot, adapter.AdapterId, ComponentState.Running, ct);

                return new PollLoop(
                    adapter,
                    ingest,
                    state,
                    fetcherOptions.PollInterval,
                    logFactory.CreateLogger<PollLoop>(),
                    readiness,
                    snapshotFactory,
                    reportCycleAsync);
            })
            .ToList()
            .AsReadOnly();
    }
}
