using Dashboard.Read.Analytics;
using Dashboard.Shared.Contracts;
using Dashboard.Shared.Data;
using Dashboard.Shared.Entities;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Dashboard.Read.Tests;

/// <summary>
/// Repository-level tests for <see cref="AnalyticsRepository"/> backed by an in-memory SQLite
/// <see cref="DashboardDbContext"/> — no Docker, no Postgres, runs on every PR in the standard
/// <c>Dashboard.Read.Tests</c> job.
///
/// Coverage targets:
/// B1 — custom funnel ladder filters exactly the configured stages in order.
/// B2 — lead-time terminal uses the custom ladder's last entry (not a hard-coded "prod").
/// B3 — default ladder reproduces the canonical 5-stage funnel.
/// B4 — case-insensitive matching: UPPER-cased config matches lowercase DB values.
/// </summary>
public sealed class AnalyticsRepositoryTests : IDisposable
{
    // ── SQLite helpers ────────────────────────────────────────────────────────

    // Keep the connection open so the in-memory database survives across EF operations.
    private readonly SqliteConnection _connection;
    private readonly DashboardDbContext _db;

    // Fixed window that all seeds fall within.
    private static readonly DateTimeOffset WindowFrom = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset WindowTo = new(2026, 12, 31, 0, 0, 0, TimeSpan.Zero);

    public AnalyticsRepositoryTests()
    {
        _connection = new SqliteConnection("DataSource=:memory:");
        _connection.Open();

        var options = new DbContextOptionsBuilder<DashboardDbContext>()
            .UseSqlite(_connection)
            // Patch: apply the string[] → CSV value converter for ParentDeployments,
            // which the production DeploymentEventConfiguration skips on SQLite
            // (it only converts DateTimeOffset).  Without this, EF throws on any row
            // where ParentDeployments is non-null because SQLite has no native array type.
            .ReplaceService<IModelCustomizer, SqliteArrayModelCustomizer>()
            .Options;

        _db = new DashboardDbContext(options);
        _db.Database.EnsureCreated();
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }

    // ── B1: Custom ladder — funnel counts ─────────────────────────────────────

    /// <summary>
    /// Custom ladder ["dev","staging","production"] — only those three stages are returned,
    /// in the configured order; an event in "canary" (outside the ladder) is absent.
    /// </summary>
    [Fact]
    public async Task GetFunnelCountsAsync_CustomLadder_ReturnsExactlyConfiguredStagesInOrder()
    {
        var opts = CustomOptions("dev", "staging", "production");
        var repo = new AnalyticsRepository(_db, opts);

        await SeedAsync(
            Ev("d1", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddDays(1)),
            Ev("d2", "svc", "staging", DeploymentStatus.Success, WindowFrom.AddDays(2)),
            Ev("d3", "svc", "production", DeploymentStatus.Success, WindowFrom.AddDays(3)),
            // Outside the ladder — must be absent from results.
            Ev("d4", "svc", "canary", DeploymentStatus.Success, WindowFrom.AddDays(4))
        );

        var result = await repo.GetFunnelCountsAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Equal("dev", result[0].Environment);
        Assert.Equal("staging", result[1].Environment);
        Assert.Equal("production", result[2].Environment);
        // Canary must not appear.
        Assert.DoesNotContain(result, r => r.Environment == "canary");
    }

    /// <summary>
    /// Each stage's count reflects distinct deployment IDs, not raw event rows.
    /// </summary>
    [Fact]
    public async Task GetFunnelCountsAsync_CustomLadder_CountsDistinctDeploymentIds()
    {
        var opts = CustomOptions("dev", "staging", "production");
        var repo = new AnalyticsRepository(_db, opts);

        await SeedAsync(
            // "dev" — 2 distinct deployment IDs.
            Ev("dep-a", "svc", "dev", DeploymentStatus.InProgress, WindowFrom.AddHours(1)),
            Ev("dep-a", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddHours(2)),
            Ev("dep-b", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddHours(3)),
            // "staging" — 1 deployment.
            Ev("dep-c", "svc", "staging", DeploymentStatus.Success, WindowFrom.AddHours(4)),
            // "production" — 0 deployments.
            Ev("d-out", "svc", "qa", DeploymentStatus.Success, WindowFrom.AddHours(5)) // not in ladder
        );

        var result = await repo.GetFunnelCountsAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.Equal(2, result[0].Count); // dev: dep-a + dep-b
        Assert.Equal(1, result[1].Count); // staging: dep-c
        Assert.Equal(0, result[2].Count); // production: none
    }

    // ── B2: Custom ladder — lead-time terminal redirection ────────────────────

    /// <summary>
    /// With ladder ["dev","staging","production"], lead-time chains to the last entry
    /// "production" (not the hard-coded string "prod"). A parent→production chain with
    /// a positive time delta must produce at least one positive sample.
    ///
    /// BLOCKED (SQLite): FetchProdTerminalWithParentsAsync uses .Any() on a string[] property
    /// that is stored as CSV text on SQLite.  EF Core's SQLite provider cannot translate
    /// .Any() on a value-converter-backed column to SQL (it IS translatable on Postgres with
    /// the native text[] column).  Test is skipped to keep the suite green; the behaviour is
    /// covered end-to-end by testing/api/tests/integration/analytics-env-vars.spec.ts (Tier B).
    /// </summary>
    [Fact(Skip = "SQLite EF translation gap: .Any() on CSV-backed string[] is untranslatable on SQLite; covered by Tier-B api-integration spec")]
    public async Task GetLeadTimeHourSamplesAsync_CustomLadder_ResolvesTerminalAsLastEntry()
    {
        var opts = CustomOptions("dev", "staging", "production");
        var repo = new AnalyticsRepository(_db, opts);

        // Parent deployment in "dev" — no ParentDeployments itself.
        var parentId = "parent-001";
        var parentAt = WindowFrom.AddDays(1);  // 2026-01-02 00:00Z

        // Terminal event in "production" that points back to the parent.
        var prodAt = WindowFrom.AddDays(2);      // 2026-01-03 00:00Z — 24 h after parent.

        await SeedAsync(
            EvWithParents("prod-event-001", "svc", "production",
                DeploymentStatus.Success, prodAt,
                parentDeployments: [parentId]),
            Ev(parentId, "svc", "dev", DeploymentStatus.Success, parentAt)
        );

        var samples = await repo.GetLeadTimeHourSamplesAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.NotEmpty(samples);
        Assert.All(samples, s => Assert.True(s > 0, $"Expected positive lead-time sample, got {s}"));
    }

    /// <summary>
    /// When no events exist in the terminal environment ("production"), lead-time returns empty.
    /// BLOCKED (SQLite): same translation gap as above — FetchProdTerminalWithParentsAsync
    /// uses .Any() on the CSV-backed ParentDeployments column.
    /// </summary>
    [Fact(Skip = "SQLite EF translation gap: .Any() on CSV-backed string[] is untranslatable on SQLite; covered by Tier-B api-integration spec")]
    public async Task GetLeadTimeHourSamplesAsync_CustomLadder_NoTerminalEvents_ReturnsEmpty()
    {
        var opts = CustomOptions("dev", "staging", "production");
        var repo = new AnalyticsRepository(_db, opts);

        // Only seed "dev" events — "production" terminal has nothing.
        await SeedAsync(
            Ev("dep-x", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddDays(1))
        );

        var samples = await repo.GetLeadTimeHourSamplesAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Empty(samples);
    }

    // ── B3: Default ladder sanity ─────────────────────────────────────────────

    /// <summary>
    /// Default AnalyticsOptions (5-stage canonical ladder) returns all five stages
    /// in the correct order: dev → staging → qa → preprod → prod.
    /// </summary>
    [Fact]
    public async Task GetFunnelCountsAsync_DefaultLadder_ReturnsFiveCanonicalStagesInOrder()
    {
        var opts = DefaultOptions();
        var repo = new AnalyticsRepository(_db, opts);

        await SeedAsync(
            Ev("d1", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddDays(1)),
            Ev("d2", "svc", "staging", DeploymentStatus.Success, WindowFrom.AddDays(2)),
            Ev("d3", "svc", "qa", DeploymentStatus.Success, WindowFrom.AddDays(3)),
            Ev("d4", "svc", "preprod", DeploymentStatus.Success, WindowFrom.AddDays(4)),
            Ev("d5", "svc", "prod", DeploymentStatus.Success, WindowFrom.AddDays(5))
        );

        var result = await repo.GetFunnelCountsAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Equal(5, result.Count);
        Assert.Equal("dev", result[0].Environment);
        Assert.Equal("staging", result[1].Environment);
        Assert.Equal("qa", result[2].Environment);
        Assert.Equal("preprod", result[3].Environment);
        Assert.Equal("prod", result[4].Environment);
        Assert.All(result, r => Assert.Equal(1, r.Count));
    }

    // ── B4: Case-insensitivity ────────────────────────────────────────────────

    /// <summary>
    /// Configure ["dev","staging","PROD"] (uppercase PROD) but seed with lowercase "prod"
    /// in the database. Funnel counts must match — no zero-count false negative.
    /// This is the key regression guard: AnalyticsFunnelEnvironments.Parse lowercases,
    /// and the SQL applies LOWER() to the DB column.
    /// </summary>
    [Fact]
    public async Task GetFunnelCountsAsync_UpperCaseConfigLowerCaseDb_MatchesCorrectly()
    {
        // Parse normalizes "PROD" → "prod"; DB stores "prod" → LOWER("prod") = "prod" → match.
        var opts = OptionsFromParsed("dev", "staging", "PROD");
        var repo = new AnalyticsRepository(_db, opts);

        await SeedAsync(
            Ev("d1", "svc", "dev", DeploymentStatus.Success, WindowFrom.AddDays(1)),
            Ev("d2", "svc", "staging", DeploymentStatus.Success, WindowFrom.AddDays(2)),
            Ev("d3", "svc", "prod", DeploymentStatus.Success, WindowFrom.AddDays(3)) // lowercase in DB
        );

        var result = await repo.GetFunnelCountsAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Equal(3, result.Count);
        // After Parse, all keys are lowercase; prod must have count = 1, not 0.
        Assert.Equal(1, result[2].Count);
        Assert.All(result, r => Assert.True(r.Count > 0,
            $"Stage '{r.Environment}' has count 0 — case-insensitive match failed."));
    }

    /// <summary>
    /// Mixed-case in the DB ("Dev", "Staging", "Prod") must still match the normalized ladder
    /// because the SQL query applies LOWER() on both sides.
    /// </summary>
    [Fact]
    public async Task GetFunnelCountsAsync_MixedCaseDbValues_MatchViaLower()
    {
        var opts = CustomOptions("dev", "staging", "prod");
        var repo = new AnalyticsRepository(_db, opts);

        // Seed with mixed-case — real-world DB convention is lowercase, but an operator
        // might have seeded with different casing before the convention was enforced.
        await SeedAsync(
            Ev("d1", "svc", "Dev", DeploymentStatus.Success, WindowFrom.AddDays(1)),
            Ev("d2", "svc", "Staging", DeploymentStatus.Success, WindowFrom.AddDays(2)),
            Ev("d3", "svc", "Prod", DeploymentStatus.Success, WindowFrom.AddDays(3))
        );

        var result = await repo.GetFunnelCountsAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.Equal(3, result.Count);
        Assert.All(result, r => Assert.Equal(1, r.Count));
    }

    /// <summary>
    /// Case-insensitivity also applies to the lead-time terminal: configure "PROD" (normalized
    /// to "prod"), seed terminal event with lowercase "prod" in the DB → chain resolves.
    /// BLOCKED (SQLite): same translation gap as the other lead-time tests.
    /// </summary>
    [Fact(Skip = "SQLite EF translation gap: .Any() on CSV-backed string[] is untranslatable on SQLite; covered by Tier-B api-integration spec")]
    public async Task GetLeadTimeHourSamplesAsync_UpperCaseConfigTerminal_MatchesLowerCaseDb()
    {
        // "PROD" normalized to "prod" by Parse; DB stores "prod".
        var opts = OptionsFromParsed("dev", "staging", "PROD");
        var repo = new AnalyticsRepository(_db, opts);

        var parentId = "parent-case-001";
        var parentAt = WindowFrom.AddDays(1);
        var prodAt = WindowFrom.AddDays(2); // 24 h after parent.

        await SeedAsync(
            EvWithParents("prod-case-001", "svc", "prod",    // lowercase "prod" in DB
                DeploymentStatus.Success, prodAt,
                parentDeployments: [parentId]),
            Ev(parentId, "svc", "dev", DeploymentStatus.Success, parentAt)
        );

        var samples = await repo.GetLeadTimeHourSamplesAsync(WindowFrom, WindowTo, CancellationToken.None);

        Assert.NotEmpty(samples);
        Assert.All(samples, s => Assert.True(s > 0));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Task SeedAsync(params DeploymentEvent[] events)
    {
        _db.DeploymentEvents.AddRange(events);
        return _db.SaveChangesAsync();
    }

    private static DeploymentEvent Ev(
        string deploymentId,
        string service,
        string environment,
        string status,
        DateTimeOffset happenedAt) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = deploymentId,
            Service = service,
            Environment = environment,
            Status = status,
            HappenedAt = happenedAt,
        };

    private static DeploymentEvent EvWithParents(
        string deploymentId,
        string service,
        string environment,
        string status,
        DateTimeOffset happenedAt,
        string[] parentDeployments) =>
        new()
        {
            Id = Guid.CreateVersion7(),
            DeploymentId = deploymentId,
            Service = service,
            Environment = environment,
            Status = status,
            HappenedAt = happenedAt,
            ParentDeployments = parentDeployments,
        };

    /// <summary>
    /// Options built from pre-lowercased tokens — simulates what the composition root
    /// produces after <see cref="AnalyticsFunnelEnvironments.Parse"/> normalizes the input.
    /// Use this when the test itself controls casing (already-normalized inputs).
    /// </summary>
    private static AnalyticsOptions CustomOptions(params string[] environments) =>
        new(environments, AnalyticsWindowGranularity.Day, 365);

    /// <summary>
    /// Options built by running the raw config value through
    /// <see cref="AnalyticsFunnelEnvironments.Parse"/> — the same path the app takes at startup.
    /// Use this for case-insensitivity tests where the raw operator input may be mixed-case.
    /// </summary>
    private static AnalyticsOptions OptionsFromParsed(params string[] rawTokens) =>
        new(AnalyticsFunnelEnvironments.Parse(string.Join(',', rawTokens)),
            AnalyticsWindowGranularity.Day, 365);

    private static AnalyticsOptions DefaultOptions() =>
        new(AnalyticsFunnelEnvironments.Default, AnalyticsWindowGranularity.Day, 365);
}

// ── SQLite array support ──────────────────────────────────────────────────────

/// <summary>
/// EF Core model customizer that applies the <c>string[] → CSV</c> value converter to
/// <see cref="DeploymentEvent.ParentDeployments"/> when running under SQLite.
///
/// Production <see cref="DeploymentEventConfiguration"/> maps the column as <c>text[]</c>
/// (Postgres native array) but does not supply a SQLite fallback converter.  Without this
/// patch EF throws when attempting to save a non-null <c>string[]</c> value on SQLite.
///
/// Registered via <c>DbContextOptionsBuilder.ReplaceService&lt;IModelCustomizer&gt;</c>
/// in <see cref="AnalyticsRepositoryTests"/> — test-only, zero production impact.
/// </summary>
internal sealed class SqliteArrayModelCustomizer(ModelCustomizerDependencies dependencies)
    : RelationalModelCustomizer(dependencies)
{
    public override void Customize(ModelBuilder modelBuilder, DbContext context)
    {
        base.Customize(modelBuilder, context);

        // Apply only when actually running under SQLite.
        if (context.Database.ProviderName != "Microsoft.EntityFrameworkCore.Sqlite")
            return;

        // Inline equivalent of ValueConverters.StringArrayToCsv (internal to Dashboard.Shared).
        var csvConverter = new ValueConverter<string[]?, string?>(
            v => v == null ? null : string.Join(',', v),
            v => v == null ? null : v.Split(',', StringSplitOptions.None));

        modelBuilder.Entity<DeploymentEvent>()
            .Property(e => e.ParentDeployments)
            .HasConversion(csvConverter);
    }
}
