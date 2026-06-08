using Dashboard.Shared.Configuration;
using Microsoft.Extensions.Configuration;

namespace Dashboard.Shared.Tests;

public sealed class NpgsqlDataSourceFactoryTests
{
    // ── helpers ───────────────────────────────────────────────────────────────

    private static IConfiguration FromMemory(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static IConfiguration Empty() => FromMemory([]);

    // ── auto-detect: password present → static auth ───────────────────────────

    [Fact]
    public void ResolveAuthMode_PasswordEnvVar_ReturnsPassword()
    {
        var config = FromMemory(new() { ["POSTGRES_PASSWORD"] = "s3cr3t" });

        Assert.Equal(PostgresAuthMode.Password, NpgsqlDataSourceFactory.ResolveAuthMode(config));
    }

    [Fact]
    public void ResolveAuthMode_PasswordAppsettings_ReturnsPassword()
    {
        var config = FromMemory(new() { ["Postgres:Password"] = "s3cr3t" });

        Assert.Equal(PostgresAuthMode.Password, NpgsqlDataSourceFactory.ResolveAuthMode(config));
    }

    [Fact]
    public void ResolveAuthMode_EnvVarWinsOverAppsettings()
    {
        // Env var present and non-empty → password mode regardless of appsettings value.
        var config = FromMemory(new()
        {
            ["POSTGRES_PASSWORD"] = "env-pass",
            ["Postgres:Password"] = "cfg-pass",
        });

        Assert.Equal(PostgresAuthMode.Password, NpgsqlDataSourceFactory.ResolveAuthMode(config));
    }

    // ── auto-detect: password absent / empty → managed-identity ──────────────

    [Fact]
    public void ResolveAuthMode_Empty_ReturnsManagedIdentity()
    {
        // No password configured at all → cloud managed-identity mode.
        Assert.Equal(PostgresAuthMode.ManagedIdentity, NpgsqlDataSourceFactory.ResolveAuthMode(Empty()));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveAuthMode_BlankPassword_ReturnsManagedIdentity(string blank)
    {
        var config = FromMemory(new() { ["POSTGRES_PASSWORD"] = blank });

        Assert.Equal(PostgresAuthMode.ManagedIdentity, NpgsqlDataSourceFactory.ResolveAuthMode(config));
    }

    // ── connection string: Password= present / absent ─────────────────────────

    [Fact]
    public void Resolve_PasswordMode_IncludesPasswordKeyword()
    {
        var config = FromMemory(new()
        {
            ["POSTGRES_USER"] = "app",
            ["POSTGRES_PASSWORD"] = "s3cr3t",
        });

        var cs = PostgresConnectionString.Resolve(config, PostgresAuthMode.Password);

        Assert.Contains(";Password=s3cr3t", cs);
    }

    [Fact]
    public void Resolve_ManagedIdentityMode_OmitsPasswordKeyword()
    {
        // Even when a password env var is present, managed-identity mode must never
        // emit Password= (the periodic-password provider supplies the token at connect time).
        var config = FromMemory(new()
        {
            ["POSTGRES_USER"] = "mi-user",
            ["POSTGRES_PASSWORD"] = "should-be-ignored",
        });

        var cs = PostgresConnectionString.Resolve(config, PostgresAuthMode.ManagedIdentity);

        Assert.DoesNotContain("Password=", cs);
        Assert.Contains("Username=mi-user", cs);
    }

    [Fact]
    public void Resolve_ManagedIdentityMode_NoPassword_NoPasswordKeyword()
    {
        // Seam contract: no "Password=" keyword emitted when in managed-identity mode.
        var cs = PostgresConnectionString.Resolve(Empty(), PostgresAuthMode.ManagedIdentity);

        Assert.DoesNotContain("Password", cs);
    }

    // ── NpgsqlDataSource creation ─────────────────────────────────────────────

    [Fact]
    public void Create_PasswordPresent_ReturnsPasswordModeDataSource()
    {
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "localhost",
            ["POSTGRES_PORT"] = "5432",
            ["POSTGRES_DB"] = "test_db",
            ["POSTGRES_USER"] = "test_user",
            ["POSTGRES_PASSWORD"] = "test_pass",
        });

        using var ds = NpgsqlDataSourceFactory.Create(config);

        Assert.NotNull(ds);
    }

    [Fact]
    public void Create_PasswordAbsent_UsesManagedIdentityWithProvidedTokenProvider()
    {
        // No password → managed-identity mode. Inject a stub to avoid reaching DefaultAzureCredential.
        var stub = new StubPostgresTokenProvider("stub-token");
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "localhost",
            ["POSTGRES_USER"] = "mi-user",
            // POSTGRES_PASSWORD intentionally absent
        });

        // Should not throw — the data source is built but not opened here.
        using var ds = NpgsqlDataSourceFactory.Create(config, stub);

        Assert.NotNull(ds);
    }

    // ── end-to-end: auto-detect + Create agree ────────────────────────────────

    [Fact]
    public void AutoDetect_PasswordPresent_FactoryUsesStaticCredentials()
    {
        var config = FromMemory(new()
        {
            ["POSTGRES_USER"] = "app",
            ["POSTGRES_PASSWORD"] = "pass123",
        });

        var mode = NpgsqlDataSourceFactory.ResolveAuthMode(config);
        var cs = PostgresConnectionString.Resolve(config, mode);

        Assert.Equal(PostgresAuthMode.Password, mode);
        Assert.Contains("Password=pass123", cs);
    }

    [Fact]
    public void AutoDetect_PasswordAbsent_FactoryOmitsPasswordFromConnectionString()
    {
        var config = FromMemory(new() { ["POSTGRES_USER"] = "mi-user" });

        var mode = NpgsqlDataSourceFactory.ResolveAuthMode(config);
        var cs = PostgresConnectionString.Resolve(config, mode);

        Assert.Equal(PostgresAuthMode.ManagedIdentity, mode);
        Assert.DoesNotContain("Password=", cs);
    }

    // ── DRY: whitespace env + non-empty appsettings agree on mode + cs ───────

    [Fact]
    public void AutoDetect_WhitespaceEnvVar_NonEmptyAppsettings_BothAgreeOnPasswordMode()
    {
        // Whitespace POSTGRES_PASSWORD is treated as absent; Postgres:Password is the
        // effective password.  Both ResolveAuthMode and Resolve must use the same helper
        // so they cannot diverge — this test enforces that guarantee.
        var config = FromMemory(new()
        {
            ["POSTGRES_USER"] = "app",
            ["POSTGRES_PASSWORD"] = "   ",       // whitespace → absent
            ["Postgres:Password"] = "cfg-pass",  // effective password
        });

        var mode = NpgsqlDataSourceFactory.ResolveAuthMode(config);
        var cs = PostgresConnectionString.Resolve(config, mode);

        // Effective password from appsettings → password mode + Password= in connection string.
        Assert.Equal(PostgresAuthMode.Password, mode);
        Assert.Contains("Password=cfg-pass", cs);
    }

    // ── design-time factory: no premature disposal ────────────────────────────

    [Fact]
    public void PostgresConnectionString_Resolve_DesignTimePathIsUsable()
    {
        // DashboardDbContextFactory uses PostgresConnectionString.Resolve(config) directly
        // (no NpgsqlDataSource created) to avoid the disposal bug.  Verify the connection
        // string it would produce is non-null and well-formed.
        var config = FromMemory(new()
        {
            ["POSTGRES_HOST"] = "db.internal",
            ["POSTGRES_USER"] = "ef_user",
            ["POSTGRES_PASSWORD"] = "ef_pass",
        });

        // Default authMode = Password, matching design-time usage.
        var cs = PostgresConnectionString.Resolve(config);

        Assert.StartsWith("Host=db.internal", cs);
        Assert.Contains(";Username=ef_user;Password=ef_pass", cs);
    }

    // ── stub ──────────────────────────────────────────────────────────────────

    private sealed class StubPostgresTokenProvider(string token) : IPostgresTokenProvider
    {
        public ValueTask<string> GetTokenAsync(CancellationToken cancellationToken) =>
            ValueTask.FromResult(token);
    }
}
