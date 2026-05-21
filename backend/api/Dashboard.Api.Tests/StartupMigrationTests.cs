namespace Dashboard.Api.Tests;

/// <summary>
/// ADR-0009 startup-applied-migration coverage. Phase 4 scaffolds the
/// shape; Phase 5 (QA) authors the assertion bodies.
///
/// <para>Test host: <c>WebApplicationFactory&lt;Dashboard.Api.Program&gt;</c>
/// (see <see cref="TestApplicationFactory"/>) — sqlite in-memory swapped in
/// for the production Npgsql provider, hosted services stripped, the
/// <c>API_TOKEN</c> env var pinned via module initializer.</para>
///
/// <para>Coverage targets:
/// <list type="bullet">
///   <item><see cref="StartupAppliesPendingMigrations_BeforeHttpListenerBinds"/>
///   — starting the host applies pending migrations against the configured
///   connection; the HTTP listener does not bind until
///   <c>MigrateAsync</c> completes.</item>
///   <item><see cref="MigrationFailureAborts_StartupAndSurfacesException"/>
///   — a failing migration aborts startup; the exception propagates out of
///   <c>Main</c>; no request is ever served.</item>
/// </list></para>
/// </summary>
public sealed class StartupMigrationTests
{
    [Fact]
    public void StartupAppliesPendingMigrations_BeforeHttpListenerBinds()
    {
        // QA fills in Phase 5
    }

    [Fact]
    public void MigrationFailureAborts_StartupAndSurfacesException()
    {
        // QA fills in Phase 5
    }
}
