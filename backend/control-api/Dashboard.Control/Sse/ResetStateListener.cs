using Dashboard.Shared.Abstractions;
using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Dashboard.Control.Sse;

/// <summary>
/// Per-instance singleton BackgroundService that:
/// <list type="number">
///   <item>Seeds <see cref="IsResetting"/> from the DB at startup (crash-recovery path).</item>
///   <item>Listens on the <c>reset_state</c> Postgres channel and updates <see cref="IsResetting"/>
///         on every <c>NOTIFY reset_state &lt;state&gt;</c> — no DB round-trip on the hot path.</item>
/// </list>
///
/// The ingest gate reads <see cref="IsResetting"/> (a volatile bool, no lock) instead of
/// issuing a per-request DB query (Fix C).
///
/// Eventual-consistency note: between a transition NOTIFY and a listener update there is a
/// sub-millisecond window where a racing ingest might slip through. This is a benign TOCTOU
/// that the old per-request DB-SELECT version also had (the truncation is atomic at the DB
/// level regardless). The brief staleness is acceptable per NFR-05.
/// </summary>
internal sealed class ResetStateListener(
    IServiceProvider services,
    IConfiguration configuration,
    ILogger<ResetStateListener> logger) : BackgroundService, Dashboard.Shared.Abstractions.IResetStateProvider
{
    private volatile bool _isResetting;

    // ── IResetStateProvider ───────────────────────────────────────────────────

    /// <summary>
    /// Returns <c>true</c> while this instance believes the reset state machine is in the
    /// <c>resetting</c> phase. Updated via <c>LISTEN reset_state</c>.
    /// </summary>
    public bool IsResetting => _isResetting;

    // ── BackgroundService ─────────────────────────────────────────────────────

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Seeding happens inside ListenAsync (after LISTEN attaches), so every (re)connect
        // re-establishes the baseline and a dropped connection cannot leave the flag stale.
        await ListenWithRetryAsync(stoppingToken);
    }

    private async Task SeedFromDatabaseAsync(CancellationToken ct)
    {
        try
        {
            await using var scope = services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
            var state = await db.ResetCycles
                .Where(r => r.Id == 1)
                .Select(r => r.State)
                .FirstOrDefaultAsync(ct);

            _isResetting = state == "resetting";
            logger.LogInformation(
                "ResetStateListener: seeded reset state from DB — IsResetting={IsResetting}.", _isResetting);
        }
        catch (Exception ex)
        {
            // Leave the flag unchanged on failure — do not clobber a known state during a reconnect.
            logger.LogWarning(ex, "ResetStateListener: could not seed reset state from DB; leaving IsResetting unchanged.");
        }
    }

    private async Task ListenWithRetryAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await ListenAsync(ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "ResetStateListener: lost Postgres connection; reconnecting in 5 s.");
                await Task.Delay(TimeSpan.FromSeconds(5), ct);
            }
        }
    }

    private async Task ListenAsync(CancellationToken ct)
    {
        var connectionString = configuration.GetConnectionString("Postgres")
            ?? throw new InvalidOperationException("ConnectionStrings:Postgres is not configured.");

        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync(ct);

        conn.Notification += (_, args) =>
        {
            var newState = args.Payload?.Trim();
            _isResetting = newState == "resetting";
            logger.LogDebug("ResetStateListener: received reset_state NOTIFY — IsResetting={IsResetting}.", _isResetting);
        };

        await using (var cmd = new NpgsqlCommand("LISTEN reset_state", conn))
            await cmd.ExecuteNonQueryAsync(ct);

        logger.LogInformation("ResetStateListener: LISTEN reset_state active.");

        // Seed AFTER LISTEN is attached: a transition NOTIFY arriving post-attach is queued and
        // applied by the handler, while this read establishes the committed baseline — no gap.
        await SeedFromDatabaseAsync(ct);

        while (!ct.IsCancellationRequested)
            await conn.WaitAsync(ct);
    }
}
