using Dashboard.Shared.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Write.Services;

/// <summary>
/// Daily background job that prunes stale history rows from three tables:
/// <list type="bullet">
///   <item><c>deployment_events</c> — rows where <c>happened_at</c> older than <c>HISTORY_RETENTION_DAYS</c> (default 365, floor 90).</item>
///   <item><c>control_stream_events</c> — rows where <c>occurred_at</c> older than 2 hours (fixed).</item>
///   <item><c>component_events</c> — rows where <c>received_at</c> older than 2 hours (fixed).</item>
/// </list>
/// <c>reset_cycle</c> and <c>fetcher_state</c> are intentionally excluded (D14).
/// </summary>
internal sealed class HistoryRetentionService(
    IServiceProvider services,
    IConfiguration configuration,
    ILogger<HistoryRetentionService> logger) : BackgroundService
{
    internal const string RetentionDaysConfigKey = "HISTORY_RETENTION_DAYS";
    internal const int DefaultRetentionDays = 365;
    internal const int MinRetentionDays = 90;
    internal static readonly TimeSpan ShortRetention = TimeSpan.FromHours(2);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Run one pass shortly after startup, then every 24 hours.
        var period = TimeSpan.FromHours(24);
        using var timer = new PeriodicTimer(period);

        await RunPrunePassAsync(DateTimeOffset.UtcNow, stoppingToken);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await RunPrunePassAsync(DateTimeOffset.UtcNow, stoppingToken);
        }
    }

    /// <summary>
    /// Executes one full prune pass. Exposed internally for unit-testability;
    /// callers supply <paramref name="now"/> so cutoff math can be verified without wall-clock coupling.
    /// </summary>
    internal async Task RunPrunePassAsync(DateTimeOffset now, CancellationToken ct)
    {
        var retentionDays = ResolveRetentionDays(configuration, logger);
        var deploymentCutoff = now.AddDays(-retentionDays);
        var shortCutoff = now.Add(-ShortRetention);

        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        try
        {
            var deploymentDeleted = await db.DeploymentEvents
                .Where(e => e.HappenedAt < deploymentCutoff)
                .ExecuteDeleteAsync(ct);

            var controlDeleted = await db.ControlStreamEvents
                .Where(e => e.OccurredAt < shortCutoff)
                .ExecuteDeleteAsync(ct);

            var componentDeleted = await db.ComponentEvents
                .Where(e => e.ReceivedAt < shortCutoff)
                .ExecuteDeleteAsync(ct);

            logger.LogInformation(
                "Retention prune: deployment_events={DeploymentDeleted} (cutoff={DeploymentCutoff:O}), " +
                "control_stream_events={ControlDeleted}, component_events={ComponentDeleted} (cutoff={ShortCutoff:O}).",
                deploymentDeleted, deploymentCutoff,
                controlDeleted,
                componentDeleted, shortCutoff);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            logger.LogError(ex, "Retention prune failed; will retry on the next daily tick.");
        }
    }

    /// <summary>
    /// Reads <c>HISTORY_RETENTION_DAYS</c> from configuration.
    /// Returns the default (365) when absent or unparseable.
    /// Clamps up to the floor (90) when a smaller positive value is supplied, and logs a warning.
    /// </summary>
    internal static int ResolveRetentionDays(IConfiguration config, ILogger logger)
    {
        var raw = config[RetentionDaysConfigKey];

        if (string.IsNullOrWhiteSpace(raw) || !int.TryParse(raw, out var parsed) || parsed <= 0)
            return DefaultRetentionDays;

        if (parsed < MinRetentionDays)
        {
            logger.LogWarning(
                "HISTORY_RETENTION_DAYS={Supplied} is below the minimum of {Min} days. " +
                "Clamping to {Min}.",
                parsed, MinRetentionDays, MinRetentionDays);
            return MinRetentionDays;
        }

        return parsed;
    }
}
