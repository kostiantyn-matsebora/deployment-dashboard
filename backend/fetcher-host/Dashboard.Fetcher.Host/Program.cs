using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// ── Options ───────────────────────────────────────────────────────────────────
var fetcherOptions = new FetcherOptions();
builder.Configuration.Bind(fetcherOptions);

// Allow env-var overrides for control-plane keys (§6).
fetcherOptions.ControlApiKey = builder.Configuration["CONTROL_API_KEY"] ?? fetcherOptions.ControlApiKey;
fetcherOptions.ComponentId = builder.Configuration["COMPONENT_ID"] ?? fetcherOptions.ComponentId;

var githubOptions = new GithubAdapterOptions();
builder.Configuration.GetSection("GitHub").Bind(githubOptions);

// Resolve BackfillMaxAge from InitialLookback when not explicitly set.
if (githubOptions.BackfillMaxAge == TimeSpan.Zero)
    githubOptions.BackfillMaxAge = fetcherOptions.EffectiveBackfillMaxAge;

// ── HTTP clients ──────────────────────────────────────────────────────────────
var apiBaseUrl = builder.Configuration["DASHBOARD_API_BASE_URL"] ?? "http://localhost:8080";
var apiKey = builder.Configuration["API_KEY"] ?? "";

builder.Services.AddHttpClient<IIngestClient, IngestClient>(c =>
{
    c.BaseAddress = new Uri(apiBaseUrl);
    c.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
});

builder.Services.AddHttpClient<IFetcherStateClient, FetcherStateClient>(c =>
{
    c.BaseAddress = new Uri(apiBaseUrl);
    c.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
});

// Control-stream subscriber — X-Control-API-Key (§5.10.2).
builder.Services.AddHttpClient<IControlStreamClient, ControlStreamClient>(c =>
{
    c.BaseAddress = new Uri(apiBaseUrl);
    c.DefaultRequestHeaders.Add("X-Control-API-Key", fetcherOptions.ControlApiKey);
    // Infinite timeout — the stream is long-lived; reconnect is handled inside the listener.
    c.Timeout = System.Threading.Timeout.InfiniteTimeSpan;
});

// Component-event poster — X-Api-Key + X-Component-Id (§5.10.4).
builder.Services.AddHttpClient<IComponentEventClient, ComponentEventClient>(c =>
{
    c.BaseAddress = new Uri(apiBaseUrl);
    c.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
    c.DefaultRequestHeaders.Add("X-Component-Id", fetcherOptions.ComponentId);
});

// GitHub raw HttpClient (for RateLimitBudget.CreateAsync + GithubClient).
builder.Services.AddHttpClient("github", c =>
{
    c.BaseAddress = new Uri(githubOptions.BaseUrl);
    c.DefaultRequestHeaders.Add("Authorization", $"Bearer {githubOptions.Token}");
    c.DefaultRequestHeaders.Add("Accept", "application/vnd.github+json");
    c.DefaultRequestHeaders.Add("X-GitHub-Api-Version", "2022-11-28");
    c.DefaultRequestHeaders.Add("User-Agent", "deployment-dashboard-fetcher");
});

// ── Singletons ────────────────────────────────────────────────────────────────
builder.Services.AddSingleton(fetcherOptions);
builder.Services.AddSingleton(githubOptions);
builder.Services.AddSingleton<WorkflowGraphCache>();

builder.Services.AddSingleton<RateLimitBudget>(sp =>
{
    var factory = sp.GetRequiredService<IHttpClientFactory>();
    var http = factory.CreateClient("github");
    var logger = sp.GetRequiredService<ILogger<RateLimitBudget>>();
    return RateLimitBudget.CreateAsync(
        http,
        githubOptions.RateLimit,
        githubOptions.RateLimitBudgetPct,
        logger,
        CancellationToken.None).GetAwaiter().GetResult();
});

builder.Services.AddSingleton<GithubClient>(sp =>
{
    var factory = sp.GetRequiredService<IHttpClientFactory>();
    var http = factory.CreateClient("github");
    var budget = sp.GetRequiredService<RateLimitBudget>();
    return new GithubClient(http, budget);
});

builder.Services.AddSingleton<VersionResolver>(sp => new VersionResolver(
    VersionSourceConfig.Parse(githubOptions.VersionSource),
    sp.GetRequiredService<WorkflowGraphCache>(),
    sp.GetRequiredService<GithubClient>()));

builder.Services.AddSingleton<BackfillRunner>();
builder.Services.AddSingleton<GithubActionsAdapter>();
builder.Services.AddSingleton<ICiCdAdapter>(sp => sp.GetRequiredService<GithubActionsAdapter>());

// PollLoop instances are shared singletons — FetcherWorker runs them; ControlStreamListener
// pauses/resumes them on reset events (F17).
builder.Services.AddSingleton<IReadOnlyList<PollLoop>>(sp =>
{
    var adapters = sp.GetRequiredService<IEnumerable<ICiCdAdapter>>();
    var ingest = sp.GetRequiredService<IIngestClient>();
    var state = sp.GetRequiredService<IFetcherStateClient>();
    var logFactory = sp.GetRequiredService<ILoggerFactory>();

    return adapters
        .Select(adapter => new PollLoop(
            adapter,
            ingest,
            state,
            fetcherOptions.PollInterval,
            logFactory.CreateLogger<PollLoop>()))
        .ToList()
        .AsReadOnly();
});

// ── Workers ───────────────────────────────────────────────────────────────────
builder.Services.AddHostedService<FetcherWorker>();
builder.Services.AddHostedService<ControlStreamListener>();

await builder.Build().RunAsync();
