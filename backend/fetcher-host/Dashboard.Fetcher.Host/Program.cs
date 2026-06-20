using Dashboard.Fetcher.Abstractions;
using Dashboard.Fetcher.Configuration;
using Dashboard.Fetcher.Control;
using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Backfill;
using Dashboard.Fetcher.GitHub.Configuration;
using Dashboard.Fetcher.GitHub.Graph;
using Dashboard.Fetcher.GitHub.Mapping;
using Dashboard.Fetcher.GitHub.RateLimit;
using Dashboard.Fetcher.GitHub.Version;
using Dashboard.Fetcher.Host.Workers;
using Dashboard.Fetcher.Ingest;
using Dashboard.Fetcher.Orchestration;
using Dashboard.Shared.ServiceFiltering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

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
builder.Services.AddSingleton(githubOptions.BuildServiceFilter());
builder.Services.AddSingleton<WorkflowGraphCache>();
builder.Services.AddSingleton<FetcherReadinessIndicator>();
builder.Services.AddSingleton<IFetcherReadinessIndicator>(
    sp => sp.GetRequiredService<FetcherReadinessIndicator>());

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

builder.Services.AddSingleton<BackfillEventBuilder>();
builder.Services.AddSingleton<BackfillRunner>();
builder.Services.AddSingleton<DeploymentStatusEventMapper>();
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
                    snapshot, adapter.AdapterId, "running", ct);

            return new PollLoop(
                adapter,
                ingest,
                state,
                fetcherOptions.PollInterval,
                logFactory.CreateLogger<PollLoop>(),
                new PollLoopReporting(readiness, snapshotFactory, reportCycleAsync));
        })
        .ToList()
        .AsReadOnly();
});

// ── Workers ───────────────────────────────────────────────────────────────────
builder.Services.AddHostedService<FetcherWorker>();

// F4: register ControlStreamListener only when CONTROL_API_KEY is set.
// An empty key means the API's control surface is disabled; attempting to connect
// would 404-loop. Log once at startup so the absence is observable.
if (!string.IsNullOrWhiteSpace(fetcherOptions.ControlApiKey))
{
    builder.Services.AddHostedService<ControlStreamListener>();
}
else
{
    var startupLogger = LoggerFactory.Create(b => b.AddConsole())
        .CreateLogger("Startup");
    startupLogger.LogInformation(
        "[ControlStream] CONTROL_API_KEY is not set — control-plane participation disabled");
}

var app = builder.Build();

// ── Health endpoints ──────────────────────────────────────────────────────────
// Liveness: process is alive. No adapter/ingest logic consulted (FETCHER_SPECIFICATION §3, §6).
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }));

// Functional readiness: reflects actual GitHub poll-cycle health (FETCHER_SPECIFICATION §6).
// Decision: 503 when last_outcome is auth_failed or error AND the loop is NOT paused for reset.
//           200 in all other cases (ok, rate_limited, paused-for-reset, never-polled).
// Paused-for-reset is an expected healthy transient — must NOT read as failed.
app.MapGet("/readyz", (IFetcherReadinessIndicator indicator) => BuildReadyzResult(indicator));

await app.RunAsync();

// ── Helpers ───────────────────────────────────────────────────────────────────

static string? OutcomeLabel(PollOutcome? outcome) => outcome switch
{
    PollOutcome.Ok => "ok",
    PollOutcome.AuthFailed => "auth_failed",
    PollOutcome.RateLimited => "rate_limited",
    PollOutcome.Error => "error",
    null => null,
    _ => outcome.ToString()?.ToLowerInvariant(),
};

static IResult BuildReadyzResult(IFetcherReadinessIndicator indicator)
{
    var outcome = indicator.LastOutcome;
    var paused = indicator.IsPausedForReset;

    var isHardFailure = !paused &&
        outcome is PollOutcome.AuthFailed or PollOutcome.Error;

    var status = outcome is PollOutcome.Ok ? "ready" : "degraded";
    var rateLimitPayload = BuildRateLimitPayload(indicator.RateLimit);

    var body = new
    {
        status,
        github = new
        {
            reachable = outcome is PollOutcome.Ok or PollOutcome.RateLimited,
            last_outcome = OutcomeLabel(outcome),
            last_success_at = indicator.LastSuccessAt,
            last_error = indicator.LastErrorSummary,
            paused_for_reset = paused,
            rate_limit = rateLimitPayload,
        },
    };

    return isHardFailure
        ? Results.Json(body, statusCode: StatusCodes.Status503ServiceUnavailable)
        : Results.Ok(body);
}

static object? BuildRateLimitPayload(RateLimitSnapshot? rl) =>
    rl is null ? null : new
    {
        used = rl.Used,
        budget = rl.Budget,
        reset_at = rl.ResetAt == DateTimeOffset.MinValue ? (DateTimeOffset?)null : rl.ResetAt,
        ci_limit = rl.CiLimit,
        ci_remaining = rl.CiRemaining,
    };
