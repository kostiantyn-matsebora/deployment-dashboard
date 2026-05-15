using Dashboard.Shared.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.Shared.Pruning;

/// <summary>
/// Daily background job that deletes deployment rows older than
/// <see cref="HistoryRetentionOptions.RetentionDays"/> (SAD §7 Retention).
///
/// <para>Default retention is 365 days (Decision §10 #2) and is
/// configurable via the <c>HISTORY_RETENTION_DAYS</c> environment variable.
/// The job runs every 24 hours; on startup it waits a short delay before
/// the first run so it doesn't compete with EF migrations or warm-up.</para>
/// </summary>
public sealed class HistoryPruningService : BackgroundService
{
    private static readonly TimeSpan Period = TimeSpan.FromHours(24);
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(1);

    private readonly IServiceProvider _services;
    private readonly HistoryRetentionOptions _options;
    private readonly ILogger<HistoryPruningService> _logger;

    public HistoryPruningService(
        IServiceProvider services,
        HistoryRetentionOptions options,
        ILogger<HistoryPruningService> logger)
    {
        _services = services;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(FirstRunDelay, stoppingToken);
        }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PruneOnceAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "History pruning run failed.");
            }

            try
            {
                await Task.Delay(Period, stoppingToken);
            }
            catch (OperationCanceledException) { return; }
        }
    }

    public async Task PruneOnceAsync(CancellationToken ct)
    {
        if (_options.RetentionDays <= 0)
        {
            _logger.LogInformation("Retention disabled (HISTORY_RETENTION_DAYS <= 0); skipping prune.");
            return;
        }

        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();

        var cutoff = DateTime.UtcNow.AddDays(-_options.RetentionDays);
        var removed = await db.Deployments
            .Where(d => d.DeployedAt < cutoff)
            .ExecuteDeleteAsync(ct);

        if (removed > 0)
        {
            _logger.LogInformation(
                "Pruned {Count} deployment rows older than {Cutoff:o}",
                removed, cutoff);
        }
    }
}

/// <summary>Configuration for <see cref="HistoryPruningService"/>.</summary>
public sealed class HistoryRetentionOptions
{
    public const int DefaultDays = 365;

    public int RetentionDays { get; init; } = DefaultDays;
}
