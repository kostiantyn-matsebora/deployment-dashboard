using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Configuration;
using Dashboard.Fetcher.Host.Extensions;

var builder = WebApplication.CreateBuilder(args);

// ── Options ───────────────────────────────────────────────────────────────────
var fetcherOptions = new FetcherOptions();
builder.Configuration.Bind(fetcherOptions);

// Apply explicit SCREAMING_SNAKE env-var overrides (§6).
// Top-level vars do not bind through .NET's PascalCase rule and must be read explicitly.
FetcherOptionsEnv.ApplyEnvOverrides(builder.Configuration, fetcherOptions);

var githubOptions = new GithubAdapterOptions();
builder.Configuration.GetSection("GitHub").Bind(githubOptions);

// Apply flat GITHUB_* env-var overrides so env wins over appsettings (§6).
GithubAdapterOptionsEnv.ApplyEnvOverrides(builder.Configuration, githubOptions);

// Resolve BackfillMaxAge from InitialLookback when not explicitly set.
if (githubOptions.BackfillMaxAge == TimeSpan.Zero)
    githubOptions.BackfillMaxAge = fetcherOptions.EffectiveBackfillMaxAge;

var apiBaseUrl = builder.Configuration["DASHBOARD_API_BASE_URL"] ?? "http://localhost:8080";
var apiKey = builder.Configuration["API_KEY"] ?? "";

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services
    .AddFetcherHttpClients(apiBaseUrl, apiKey, fetcherOptions, githubOptions)
    .AddFetcherSingletons(fetcherOptions, githubOptions)
    .AddFetcherWorkers(fetcherOptions);

// ── Run ───────────────────────────────────────────────────────────────────────
var app = builder.Build();

app.MapFetcherHealthEndpoints();

await app.RunAsync();
