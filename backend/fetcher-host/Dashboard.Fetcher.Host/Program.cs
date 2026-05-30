using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Ingest;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// ── Options ───────────────────────────────────────────────────────────────────
var fetcherOptions = new FetcherOptions();
builder.Configuration.Bind(fetcherOptions);

var githubOptions = new GithubAdapterOptions();
builder.Configuration.GetSection("GitHub").Bind(githubOptions);

// Resolve BackfillMaxAge from InitialLookback when not explicitly set
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

// GitHub raw HttpClient (for RateLimitBudget.CreateAsync + GithubClient)
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

// ── Worker ────────────────────────────────────────────────────────────────────
builder.Services.AddHostedService<FetcherWorker>();

await builder.Build().RunAsync();
