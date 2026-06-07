using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.Ingest;

namespace Dashboard.Fetcher.Host.Extensions;

/// <summary>
/// Registers the typed and named <see cref="System.Net.Http.HttpClient"/> instances required
/// by the fetcher host (§3 solution layout).
/// </summary>
internal static class FetcherHttpClientExtensions
{
    /// <summary>
    /// Adds all fetcher HTTP clients to <paramref name="services"/>:
    /// <list type="bullet">
    ///   <item>Typed clients for ingest, state, control-stream, and component-event posting.</item>
    ///   <item>Named <c>"github"</c> client used by <c>RateLimitBudget</c> and <c>GithubClient</c>.</item>
    /// </list>
    /// </summary>
    internal static IServiceCollection AddFetcherHttpClients(
        this IServiceCollection services,
        string apiBaseUrl,
        string apiKey,
        FetcherOptions fetcherOptions,
        GithubAdapterOptions githubOptions)
    {
        services.AddHttpClient<IIngestClient, IngestClient>(c =>
        {
            c.BaseAddress = new Uri(apiBaseUrl);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderApiKey, apiKey);
        });

        services.AddHttpClient<IFetcherStateClient, FetcherStateClient>(c =>
        {
            c.BaseAddress = new Uri(apiBaseUrl);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderApiKey, apiKey);
        });

        // Control-stream subscriber — X-Control-API-Key (§5.10.2).
        services.AddHttpClient<IControlStreamClient, ControlStreamClient>(c =>
        {
            c.BaseAddress = new Uri(apiBaseUrl);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderControlApiKey, fetcherOptions.ControlApiKey);
            // Infinite timeout — the stream is long-lived; reconnect is handled inside the listener.
            c.Timeout = System.Threading.Timeout.InfiniteTimeSpan;
        });

        // Component-event poster — X-Api-Key + X-Component-Id (§5.10.4).
        services.AddHttpClient<IComponentEventClient, ComponentEventClient>(c =>
        {
            c.BaseAddress = new Uri(apiBaseUrl);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderApiKey, apiKey);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderComponentId, fetcherOptions.ComponentId);
        });

        // GitHub raw HttpClient (for RateLimitBudget.CreateAsync + GithubClient).
        services.AddHttpClient(FetcherConstants.GitHubHttpClientName, c =>
        {
            c.BaseAddress = new Uri(githubOptions.BaseUrl);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderAuthorization, $"Bearer {githubOptions.Token}");
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderAccept, FetcherConstants.GitHubAcceptValue);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderGitHubApiVersion, FetcherConstants.GitHubApiVersion);
            c.DefaultRequestHeaders.Add(FetcherConstants.HeaderUserAgent, FetcherConstants.GitHubUserAgent);
        });

        return services;
    }
}
