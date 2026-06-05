using Dashboard.Shared.Configuration;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Shared.Tests;

public sealed class PostgresConnectionStringTests
{
    // ── helpers ──────────────────────────────────────────────────────────────

    private static IConfiguration FromMemory(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static IConfiguration Empty() => FromMemory([]);

    // ── defaults ─────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_EmptyConfiguration_UsesBuiltInDefaults()
    {
        var result = PostgresConnectionString.Resolve(Empty());

        Assert.Equal(
            "Host=postgres;Port=5432;Database=deployment_dashboard;Username=;Password=",
            result);
    }

    // ── appsettings section ───────────────────────────────────────────────────

    [Fact]
    public void Resolve_AppsettingsSection_OverridesDefaults()
    {
        var config = FromMemory(new()
        {
            ["Postgres:Host"] = "db.internal",
            ["Postgres:Port"] = "5433",
            ["Postgres:Database"] = "my_db",
            ["Postgres:Username"] = "app",
            ["Postgres:Password"] = "secret",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Equal(
            "Host=db.internal;Port=5433;Database=my_db;Username=app;Password=secret",
            result);
    }

    [Fact]
    public void Resolve_PartialAppsettingsSection_FallsBackToDefaultsForMissingParts()
    {
        var config = FromMemory(new()
        {
            ["Postgres:Username"] = "myuser",
            ["Postgres:Password"] = "mypass",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Equal(
            "Host=postgres;Port=5432;Database=deployment_dashboard;Username=myuser;Password=mypass",
            result);
    }

    // ── POSTGRES_* env vars ───────────────────────────────────────────────────

    [Fact]
    public void Resolve_EnvVars_OverrideAppsettingsSection()
    {
        // appsettings section + env vars set; env vars must win.
        var config = FromMemory(new()
        {
            ["Postgres:Host"] = "appsettings-host",
            ["Postgres:Port"] = "9999",
            ["Postgres:Database"] = "appsettings-db",
            ["Postgres:Username"] = "appsettings-user",
            ["Postgres:Password"] = "appsettings-pass",
            // env vars — AddInMemoryCollection resolves them through IConfiguration
            // so we can use the key names the helper reads directly.
            ["POSTGRES_HOST"] = "env-host",
            ["POSTGRES_PORT"] = "5433",
            ["POSTGRES_DB"] = "env-db",
            ["POSTGRES_USER"] = "env-user",
            ["POSTGRES_PASSWORD"] = "env-pass",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Equal(
            "Host=env-host;Port=5433;Database=env-db;Username=env-user;Password=env-pass",
            result);
    }

    [Fact]
    public void Resolve_PartialEnvVars_FallsBackToAppsettingsThenDefaultsPerPart()
    {
        // POSTGRES_HOST overrides; remaining parts come from appsettings.
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "override-host",
            ["Postgres:Port"] = "5433",
            ["Postgres:Username"] = "cfg-user",
            ["Postgres:Password"] = "cfg-pass",
            // Database is absent everywhere → built-in default.
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Equal(
            "Host=override-host;Port=5433;Database=deployment_dashboard;Username=cfg-user;Password=cfg-pass",
            result);
    }

    // ── whitespace / blank values treated as absent ───────────────────────────

    [Fact]
    public void Resolve_WhitespaceEnvVar_FallsThroughToAppsettings()
    {
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "   ",     // whitespace → treat as absent
            ["Postgres:Host"] = "cfg-host",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Contains("Host=cfg-host", result);
    }

    [Fact]
    public void Resolve_WhitespaceAppsettingsValue_FallsThroughToDefault()
    {
        var config = FromMemory(new()
        {
            ["Postgres:Host"] = "   ",   // whitespace → treat as absent
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.Contains("Host=postgres", result);
    }

    // ── output format ─────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_OutputFormat_MatchesNpgsqlKeywordValuePairs()
    {
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "h",
            ["POSTGRES_PORT"] = "1234",
            ["POSTGRES_DB"] = "d",
            ["POSTGRES_USER"] = "u",
            ["POSTGRES_PASSWORD"] = "p",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.StartsWith("Host=", result);
        Assert.Contains(";Port=", result);
        Assert.Contains(";Database=", result);
        Assert.Contains(";Username=", result);
        Assert.Contains(";Password=", result);
    }
}
