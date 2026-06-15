using Dashboard.Fetcher.GitHub;
using Dashboard.Fetcher.GitHub.Configuration;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Fetcher.Tests.Configuration;

public sealed class GithubAdapterOptionsEnvTests
{
    // ── GITHUB_BASE_URL ──────────────────────────────────────────────────────

    [Fact]
    public void BaseUrl_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_BASE_URL"] = "https://ghes.example.com" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("https://ghes.example.com", options.BaseUrl);
    }

    [Fact]
    public void BaseUrl_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("https://api.github.com", options.BaseUrl);
    }

    // ── GITHUB_TOKEN ─────────────────────────────────────────────────────────

    [Fact]
    public void Token_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_TOKEN"] = "ghp_secret" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("ghp_secret", options.Token);
    }

    [Fact]
    public void Token_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.Token);
    }

    [Fact]
    public void Token_KeepsDefault_WhenValueIsEmpty()
    {
        var options = new GithubAdapterOptions();
        options.Token = "pre-existing";
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_TOKEN"] = "" });

        var exception = Record.Exception(() => GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal("pre-existing", options.Token);
    }

    // ── GITHUB_REPOS ─────────────────────────────────────────────────────────

    [Fact]
    public void Repos_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_REPOS"] = "owner/repo-a,owner/repo-b" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("owner/repo-a,owner/repo-b", options.Repos);
    }

    [Fact]
    public void Repos_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.Repos);
    }

    // ── GITHUB_VERSION_SOURCE ─────────────────────────────────────────────────

    [Fact]
    public void VersionSource_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_VERSION_SOURCE"] = "payload:version" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("payload:version", options.VersionSource);
    }

    [Fact]
    public void VersionSource_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("attribute:sha", options.VersionSource);
    }

    // ── GITHUB_SERVICE_MAP ───────────────────────────────────────────────────

    [Fact]
    public void ServiceMap_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_SERVICE_MAP"] = "deploy=my-service" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("deploy=my-service", options.ServiceMap);
    }

    [Fact]
    public void ServiceMap_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("", options.ServiceMap);
    }

    // ── GITHUB_RATE_LIMIT ────────────────────────────────────────────────────

    [Fact]
    public void RateLimit_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_RATE_LIMIT"] = "5000" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(5000, options.RateLimit);
    }

    [Fact]
    public void RateLimit_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(0, options.RateLimit);
    }

    [Fact]
    public void RateLimit_KeepsDefault_WhenValueUnparseable()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_RATE_LIMIT"] = "garbage" });

        var exception = Record.Exception(() => GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal(0, options.RateLimit);
    }

    // ── GITHUB_RATE_LIMIT_BUDGET_PCT ─────────────────────────────────────────

    [Fact]
    public void RateLimitBudgetPct_OverridesDefault_WhenKeyPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_RATE_LIMIT_BUDGET_PCT"] = "50" });

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(50, options.RateLimitBudgetPct);
    }

    [Fact]
    public void RateLimitBudgetPct_KeepsDefault_WhenKeyAbsent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal(30, options.RateLimitBudgetPct);
    }

    [Fact]
    public void RateLimitBudgetPct_KeepsDefault_WhenValueUnparseable()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?> { ["GITHUB_RATE_LIMIT_BUDGET_PCT"] = "garbage" });

        var exception = Record.Exception(() => GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options));

        Assert.Null(exception);
        Assert.Equal(30, options.RateLimitBudgetPct);
    }

    // ── absent keys — all defaults survive together ───────────────────────────

    [Fact]
    public void AllDefaults_Preserved_WhenNoKeysPresent()
    {
        var options = new GithubAdapterOptions();
        var config = BuildConfig(new Dictionary<string, string?>());

        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options);

        Assert.Equal("https://api.github.com", options.BaseUrl);
        Assert.Equal("", options.Token);
        Assert.Equal("", options.Repos);
        Assert.Equal("attribute:sha", options.VersionSource);
        Assert.Equal("", options.ServiceMap);
        Assert.Equal(0, options.RateLimit);
        Assert.Equal(30, options.RateLimitBudgetPct);
    }

    // ── layering integration: flat GITHUB_* overrides appsettings GitHub: base ─

    [Fact]
    public void Layering_FlatEnv_OverridesAppsettingsBase()
    {
        // Mirrors what Program.cs does:
        //   1. GetSection("GitHub").Bind(options)   — appsettings base
        //   2. GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options) — flat env override
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["GitHub:Token"] = "from-appsettings",
            ["GITHUB_TOKEN"] = "from-env",
        });

        var options = new GithubAdapterOptions();
        config.GetSection("GitHub").Bind(options);          // step 1: bind appsettings section
        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options); // step 2: flat env wins

        Assert.Equal("from-env", options.Token);
    }

    [Fact]
    public void Layering_AppsettingsBase_SurvivesWhenFlatEnvAbsent()
    {
        // Only the appsettings section key is set; no flat GITHUB_TOKEN env var.
        var config = BuildConfig(new Dictionary<string, string?>
        {
            ["GitHub:Token"] = "from-appsettings",
        });

        var options = new GithubAdapterOptions();
        config.GetSection("GitHub").Bind(options);          // step 1: bind appsettings section
        GithubAdapterOptionsEnv.ApplyEnvOverrides(config, options); // step 2: no flat key → no change

        Assert.Equal("from-appsettings", options.Token);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();
}
