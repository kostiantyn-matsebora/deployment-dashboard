using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Adapters.GitHubActions;
using Dashboard.Fetcher.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;

namespace Dashboard.Fetcher.DependencyInjection;

/// <summary>
/// Composition-root extensions for the fetcher (CR-0009 + ADR-0004).
/// The host calls <see cref="AddCiCdFetcher"/> once with bound
/// <see cref="FetcherOptions"/> and per-adapter env vars resolved; this
/// method handles the rest (typed HttpClients, resilience handlers,
/// adapter implementations, worker registration).
/// </summary>
public static class ServiceCollectionExtensions
{
    /// <summary>Env var for the GitHub PAT used by the GHA adapter.</summary>
    public const string GitHubTokenEnvVar = "GHA_TOKEN";

    /// <summary>Env var for an optional GHE / GitHub Enterprise API base URL.</summary>
    public const string GitHubApiBaseUrlEnvVar = "GHA_API_BASE_URL";

    /// <summary>Default base URL for the public github.com REST API.</summary>
    public const string DefaultGitHubApiBaseUrl = "https://api.github.com/";

    public static IServiceCollection AddCiCdFetcher(
        this IServiceCollection services,
        FetcherOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        services.AddSingleton(options);
        services.AddSingleton<FetcherStateClient>();

        AddWriteApiHttpClient(services, options);

        // GHA adapter — register only when the operator opted in via FETCHER_ADAPTERS.
        if (options.AdapterIds.Any(id => string.Equals(id, "github-actions", StringComparison.Ordinal)))
        {
            AddGitHubActionsAdapter(services);
            services.AddSingleton<ICiCdAdapter, GitHubActionsAdapter>();
        }

        services.AddHostedService<FetcherWorker>();
        return services;
    }

    /// <summary>
    /// Typed <see cref="HttpClient"/> for the three Write-API endpoints the
    /// fetcher calls. Base URL + <c>X-Api-Key</c> are pinned here; the
    /// <c>X-Progress-Reporter</c> value varies per request and is set by the
    /// caller (<see cref="FetcherStateClient"/>).
    /// </summary>
    private static void AddWriteApiHttpClient(IServiceCollection services, FetcherOptions options)
    {
        var baseUrl = options.WriteApiUrl.EndsWith('/') ? options.WriteApiUrl : options.WriteApiUrl + "/";

        services.AddHttpClient(FetcherStateClient.HttpClientName, http =>
        {
            http.BaseAddress = new Uri(baseUrl);
            http.DefaultRequestHeaders.Add(FetcherStateClient.ApiKeyHeaderName, options.WriteApiKey);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("dashboard-fetcher/0.1");
        })
        .AddStandardResilienceHandler(o =>
        {
            // The standard handler bundles: rate-limit / timeout / retry /
            // circuit-breaker / per-attempt timeout. Retry-with-jitter is
            // built in (ADR-0004 § Host responsibilities — retry policy).
            // We leave most defaults alone; tighten only the per-attempt
            // timeout so a stuck Write-API call doesn't hold a poll cycle.
            o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(15);
            o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(45);
            // Microsoft.Extensions.Http.Resilience invariant:
            //   CircuitBreaker.SamplingDuration >= 2 * AttemptTimeout.Timeout
            // Default SamplingDuration is 30s; with AttemptTimeout=15s this
            // sits exactly at the boundary and is brittle to future tuning.
            // Pin to 60s for ≥4× margin so a small bump of AttemptTimeout
            // never trips OptionsValidationException at host build time.
            o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(60);
        });
    }

    /// <summary>
    /// Typed <see cref="HttpClient"/> for the GitHub REST API. Reads PAT +
    /// optional GHE base URL from env vars (per CR-0009 § 3d — env-only auth
    /// for MVP; Key Vault wiring deferred).
    /// </summary>
    private static void AddGitHubActionsAdapter(IServiceCollection services)
    {
        var baseUrl = Environment.GetEnvironmentVariable(GitHubApiBaseUrlEnvVar);
        if (string.IsNullOrWhiteSpace(baseUrl)) baseUrl = DefaultGitHubApiBaseUrl;
        if (!baseUrl.EndsWith('/')) baseUrl += "/";

        var token = Environment.GetEnvironmentVariable(GitHubTokenEnvVar);

        services.AddHttpClient(GitHubActionsAdapter.HttpClientName, http =>
        {
            http.BaseAddress = new Uri(baseUrl);
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            http.DefaultRequestHeaders.UserAgent.ParseAdd("dashboard-fetcher/0.1");
            http.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
            if (!string.IsNullOrWhiteSpace(token))
            {
                http.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            }
        })
        .AddStandardResilienceHandler(o =>
        {
            // GHA is more latency-tolerant than the in-cluster Write API;
            // give the per-attempt budget a bit more headroom for cold paths.
            o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(20);
            o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(60);
            // Microsoft.Extensions.Http.Resilience invariant:
            //   CircuitBreaker.SamplingDuration >= 2 * AttemptTimeout.Timeout
            // With AttemptTimeout=20s the required minimum is 40s; the
            // default of 30s causes OptionsValidationException on host build
            // (crash-loop on container startup). Pin to 60s for ≥3× margin.
            o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(60);
        });
    }
}
