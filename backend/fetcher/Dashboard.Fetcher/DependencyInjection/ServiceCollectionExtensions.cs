using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Adapters.GitHubActions;
using Dashboard.Fetcher.Hosting;
using Dashboard.Shared.Fetcher;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Http.Resilience;
using Microsoft.Extensions.Logging;

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

    /// <summary>
    /// Compose-default placeholder for <c>GHA_TOKEN</c> — the literal value
    /// baked into <c>install/docker-compose.release.yml</c> when the operator
    /// has not supplied a real PAT (demo mode, public-repo probing). Mirrored
    /// here as the contract anchor: the installer ships this placeholder,
    /// the adapter recognises it as "no auth — go anonymous."
    /// </summary>
    public const string AnonymousTokenPlaceholder = "local-dev-gha-token-placeholder";

    /// <summary>
    /// True when <paramref name="token"/> is null / empty / whitespace, OR
    /// equals the <see cref="AnonymousTokenPlaceholder"/>. In both cases the
    /// HTTP transport MUST omit the <c>Authorization</c> header entirely so
    /// requests hit GitHub's 60-req/h anonymous bucket against public repos
    /// (sending an empty / placeholder <c>Bearer</c> header would 401).
    /// </summary>
    public static bool IsAnonymousToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return true;
        return string.Equals(token, AnonymousTokenPlaceholder, StringComparison.Ordinal);
    }

    /// <summary>
    /// Apply GitHub-API authorization to <paramref name="http"/> per
    /// anonymous-mode rules: real PAT → <c>Authorization: Bearer &lt;token&gt;</c>;
    /// anonymous (null / empty / whitespace / placeholder) → no header at all.
    /// Single chokepoint for both <see cref="AddGitHubActionsAdapter"/> and
    /// the adapter unit tests.
    /// </summary>
    public static void ConfigureGitHubAuthorization(HttpClient http, string? token)
    {
        ArgumentNullException.ThrowIfNull(http);
        if (IsAnonymousToken(token))
        {
            // Explicitly clear in case a previously-cached client carried one.
            http.DefaultRequestHeaders.Authorization = null;
            return;
        }

        http.DefaultRequestHeaders.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public static IServiceCollection AddCiCdFetcher(
        this IServiceCollection services,
        FetcherOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        // CR-0011 § 3a startup validation — fail loud + immediate on
        // misconfigured rate-limit env vars. Same posture as the existing
        // WriteApiUrl + WriteApiKey contract: refuse to start rather than
        // silently no-op.
        ValidateWriteApiSurface(options);
        ValidateRateLimitGovernance(options);

        services.AddSingleton(options);
        services.AddSingleton<FetcherStateClient>();
        services.AddSingleton<FetcherUsageClient>();

        // CR-0011 § 3c: in-memory rate-limit usage cache. Registered here
        // for the standalone fetcher process (debug / future loopback)
        // AND in the API host composition root so the Write + Read
        // endpoint groups see the same singleton. Idempotent — TryAdd
        // semantics not strictly required since the fetcher process and
        // the API process don't share DI containers in production, but
        // keeping the registration here keeps the surface complete.
        services.AddSingleton<IFetcherUsageCache, InMemoryFetcherUsageCache>();

        AddWriteApiHttpClient(services, options);

        // GHA adapter — register only when the operator opted in via FETCHER_ADAPTERS.
        if (options.AdapterIds.Any(id => string.Equals(id, "github-actions", StringComparison.Ordinal)))
        {
            AddGitHubActionsAdapter(services);
            services.AddSingleton<ICiCdAdapter, GitHubActionsAdapter>();
        }

        services.AddHostedService<FetcherWorker>();

        // CR-0011 § 3a — one INFO line at host startup so the operator can
        // see which mode + cap is active without grepping env vars. Wired
        // as a tiny IHostedService so it fires AFTER DI is fully built
        // (the legitimate way to log at startup from DI registration code).
        services.AddHostedService<RateLimitStartupLogger>();

        return services;
    }

    /// <summary>
    /// Mirror of the existing implicit contract: <c>WriteApiUrl</c> +
    /// <c>WriteApiKey</c> are required for the HttpClient registration
    /// below. The fetcher host already validates these via env-var binding,
    /// but tests + future callers may invoke <see cref="AddCiCdFetcher"/>
    /// directly — keep the same loud-failure posture here so DI errors
    /// surface as a clean <see cref="InvalidOperationException"/> rather
    /// than a downstream <c>UriFormatException</c> on first HTTP call.
    /// </summary>
    private static void ValidateWriteApiSurface(FetcherOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.WriteApiUrl))
        {
            throw new InvalidOperationException(
                $"{nameof(FetcherOptions)}.{nameof(FetcherOptions.WriteApiUrl)} is required (env DASHBOARD_WRITE_API_URL).");
        }

        if (string.IsNullOrWhiteSpace(options.WriteApiKey))
        {
            throw new InvalidOperationException(
                $"{nameof(FetcherOptions)}.{nameof(FetcherOptions.WriteApiKey)} is required (env DASHBOARD_WRITE_API_KEY).");
        }
    }

    /// <summary>
    /// CR-0011 § 3a — validate the rate-limit env vars at host startup.
    /// Refuses to start on negative absolute, non-positive absolute, or
    /// percentage outside 1..100. Matches the FR-18 acceptance criterion:
    /// "explicit absolute number overrides percentage of an upstream-
    /// reported total" — which requires the absolute to be a valid
    /// positive integer when set.
    /// </summary>
    private static void ValidateRateLimitGovernance(FetcherOptions options)
    {
        if (options.RateLimitAbsolute is int abs && abs <= 0)
        {
            throw new InvalidOperationException(
                $"{nameof(FetcherOptions)}.{nameof(FetcherOptions.RateLimitAbsolute)} (env FETCHER_RATE_LIMIT_ABSOLUTE) must be positive when set; got {abs}.");
        }

        if (options.RateLimitPercentage is int pct && (pct < 1 || pct > 100))
        {
            throw new InvalidOperationException(
                $"{nameof(FetcherOptions)}.{nameof(FetcherOptions.RateLimitPercentage)} (env FETCHER_RATE_LIMIT_PERCENTAGE) must be in 1..100 when set; got {pct}.");
        }
    }

    /// <summary>
    /// CR-0011 § 3a startup-log hosted service. Emits one INFO line on
    /// <see cref="StartAsync"/> stating the active rate-limit mode +
    /// resolved cap so the operator sees the effective configuration
    /// without grepping env vars. Stateless; never reads the upstream.
    /// </summary>
    internal sealed class RateLimitStartupLogger : IHostedService
    {
        private readonly FetcherOptions _options;
        private readonly ILogger<RateLimitStartupLogger> _logger;

        public RateLimitStartupLogger(FetcherOptions options, ILogger<RateLimitStartupLogger> logger)
        {
            _options = options;
            _logger = logger;
        }

        public Task StartAsync(CancellationToken cancellationToken)
        {
            var isAbsolute = RateLimitResolver.IsAbsoluteMode(_options);
            var pctDisplay = isAbsolute
                ? "n/a"
                : (_options.RateLimitPercentage ?? RateLimitResolver.DefaultPercentage).ToString(System.Globalization.CultureInfo.InvariantCulture) + "%";
            var absDisplay = isAbsolute
                ? _options.RateLimitAbsolute!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)
                : "n/a";
            var mode = isAbsolute ? "absolute" : "percentage";

            _logger.LogInformation(
                "FetcherRateLimit mode={Mode} resolvedAbsolute={Abs} resolvedPercentage={Pct}",
                mode, absDisplay, pctDisplay);

            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
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
            // Anonymous-mode aware — placeholder / empty token → no
            // Authorization header so public-repo demo / probe paths hit
            // GitHub's 60/h anonymous bucket instead of 401.
            ConfigureGitHubAuthorization(http, token);
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
