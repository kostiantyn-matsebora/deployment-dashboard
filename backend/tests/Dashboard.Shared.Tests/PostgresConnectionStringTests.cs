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

    // ── SslMode — ManagedIdentity auth mode ──────────────────────────────────

    [Fact]
    public void Resolve_ManagedIdentity_NoSslVar_OmitsPasswordAndUsesRequireSsl()
    {
        // No SSL config at all → ManagedIdentity default is SslMode=Require.
        var result = PostgresConnectionString.Resolve(Empty(), PostgresAuthMode.ManagedIdentity);

        Assert.Equal(
            "Host=postgres;Port=5432;Database=deployment_dashboard;Username=;SslMode=Require",
            result);
    }

    [Fact]
    public void Resolve_ManagedIdentity_EnvSslVar_AppliesThatSslModeAndOmitsPassword()
    {
        // POSTGRES_SSL_MODE=VerifyFull → result uses VerifyFull; no Password= anywhere.
        var config = FromMemory(new()
        {
            ["POSTGRES_SSL_MODE"] = "VerifyFull",
        });

        var result = PostgresConnectionString.Resolve(config, PostgresAuthMode.ManagedIdentity);

        Assert.EndsWith(";Username=;SslMode=VerifyFull", result);
        Assert.DoesNotContain("Password=", result);
    }

    [Fact]
    public void Resolve_ManagedIdentity_EnvSslVarWinsOverAppsettings()
    {
        // Appsettings says Require; env says Disable — env must win.
        var config = FromMemory(new()
        {
            ["Postgres:SslMode"] = "Require",
            ["POSTGRES_SSL_MODE"] = "Disable",
        });

        var result = PostgresConnectionString.Resolve(config, PostgresAuthMode.ManagedIdentity);

        Assert.EndsWith(";SslMode=Disable", result);
    }

    // ── SslMode — Password auth mode ─────────────────────────────────────────

    [Fact]
    public void Resolve_Password_NoSslVar_OmitsSslMode()
    {
        // Password mode with no SSL config → no SslMode keyword in output.
        var result = PostgresConnectionString.Resolve(Empty());

        Assert.Equal(
            "Host=postgres;Port=5432;Database=deployment_dashboard;Username=;Password=",
            result);
        Assert.DoesNotContain("SslMode", result);
    }

    [Fact]
    public void Resolve_Password_EnvSslVar_AppendsSslModeAfterPassword()
    {
        // POSTGRES_SSL_MODE present → SslMode appended after Password segment.
        var config = FromMemory(new()
        {
            ["POSTGRES_USER"] = "appuser",
            ["POSTGRES_PASSWORD"] = "s3cr3t",
            ["POSTGRES_SSL_MODE"] = "Require",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.EndsWith(";Password=s3cr3t;SslMode=Require", result);
    }

    [Fact]
    public void Resolve_Password_AppsettingsSslMode_AppendsSslModeAfterPassword()
    {
        // Postgres:SslMode appsettings key (no env var) → SslMode appended after Password.
        var config = FromMemory(new()
        {
            ["Postgres:Username"] = "appuser",
            ["Postgres:Password"] = "s3cr3t",
            ["Postgres:SslMode"] = "Require",
        });

        var result = PostgresConnectionString.Resolve(config);

        Assert.EndsWith(";Password=s3cr3t;SslMode=Require", result);
    }
}
