using Dashboard.Shared.Persistence;
using Dashboard.Shared.Pruning;
using Dashboard.Shared.Realtime;
using Dashboard.Shared.Topology;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dashboard.ReadApi;

/// <summary>
/// DI registrations specific to the Read surface (SAD §7 "Backend module
/// architecture" + §10 Decision 11). Called from the API host's
/// composition root via <c>services.AddReadApi(configuration)</c>.
///
/// <para>The Read surface needs:</para>
/// <list type="bullet">
///   <item><see cref="HistoryRetentionOptions"/> bound from
///   <c>HISTORY_RETENTION_DAYS</c> (env wins; SAD §7 "Retention").</item>
///   <item><see cref="HistoryPruningService"/> as a hosted service —
///   daily pruning job (SAD §7 WBS pruning).</item>
///   <item><see cref="TopologyOptions"/>, <see cref="TopologyConfigStore"/>,
///   and <see cref="TopologyBuilder"/> — server-side config + per-request
///   topology derivation (SAD §7 "Configuration — Read API topology").</item>
///   <item><see cref="SlotUpdateBroker"/> + <see cref="DeploymentListener"/>
///   — long-lived PostgreSQL <c>LISTEN</c> subscription + in-process SSE
///   fan-out (SAD §7 Real-time path; NFR-05 stateless rules).</item>
/// </list>
///
/// <para>EF Core <c>DbContext</c> and JSON options are owned by the host
/// (shared across surfaces). They are NOT re-registered here.</para>
/// </summary>
public static class ReadApiServiceCollectionExtensions
{
    public static IServiceCollection AddReadApi(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection (env ConnectionStrings__DefaultConnection) is required.");

        var retentionDays = ParseRetention(configuration);
        services.AddSingleton(new HistoryRetentionOptions { RetentionDays = retentionDays });
        services.AddHostedService<HistoryPruningService>();

        // SAD §7 "Configuration — Read API topology": bootstrap defaults
        // from appsettings.json under the "Topology" section.
        var topologyOptions = configuration.GetSection(TopologyOptions.SectionName)
            .Get<TopologyOptions>() ?? new TopologyOptions();
        services.AddSingleton(topologyOptions);
        services.AddSingleton<TopologyConfigStore>();
        services.AddSingleton<TopologyBuilder>(sp => new TopologyBuilder(
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<TopologyBuilder>()));

        // Real-time fan-out. The listener subscribes once per replica;
        // SlotUpdateBroker is a singleton because every connected SSE
        // client must see the same in-process stream.
        services.AddSingleton<SlotUpdateBroker>();
        services.AddSingleton<DeploymentListener>(sp => new DeploymentListener(
            connectionString,
            sp.GetRequiredService<SlotUpdateBroker>(),
            sp.GetRequiredService<IServiceScopeFactory>(),
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<DeploymentListener>()));
        services.AddHostedService(sp => sp.GetRequiredService<DeploymentListener>());

        return services;
    }

    private static int ParseRetention(IConfiguration cfg)
    {
        var raw = Environment.GetEnvironmentVariable("HISTORY_RETENTION_DAYS")
            ?? cfg["HISTORY_RETENTION_DAYS"];
        return int.TryParse(raw, out var n) && n > 0 ? n : HistoryRetentionOptions.DefaultDays;
    }
}
