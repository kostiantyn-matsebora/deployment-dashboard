using Dashboard.ReadApi.Endpoints;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Pruning;
using Dashboard.Shared.Realtime;
using Dashboard.Shared.Security;
using Dashboard.Shared.Topology;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.ReadApi;

/// <summary>
/// Entry point for the Read API. Owns:
///   - GET    /api/deployments                          — matrix
///   - GET    /api/deployments/{service}/{environment}  — single slot
///   - GET    /api/deployments/{service}/{environment}/history — last N
///   - GET    /api/environments                         — discovery
///   - GET    /api/services                             — discovery
///   - GET    /api/stream                               — SSE
///   - GET    /api/config/topology                      — topology config (unauth)
///   - PATCH  /api/config/topology                      — topology config (X-Api-Key)
///   - GET    /health                                   — liveness + DB ping
///
/// JSON only: the Angular SPA ships in its own nginx container behind the
/// App Gateway; the Read API does not serve static assets or HTML.
///
/// Stateless: every read hits the database directly; the SSE listener uses
/// its own dedicated connection separate from the request pool.
/// </summary>
public sealed class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection (env ConnectionStrings__DefaultConnection) is required.");

        var retentionDays = ParseRetention(builder.Configuration);

        builder.Services.AddDbContext<DashboardDbContext>(opt =>
            opt.UseNpgsql(connectionString, npg =>
                npg.MigrationsAssembly(typeof(DashboardDbContext).Assembly.FullName)));

        builder.Services.AddSingleton(new HistoryRetentionOptions { RetentionDays = retentionDays });
        builder.Services.AddHostedService<HistoryPruningService>();

        // SAD §7 "Configuration — Read API topology": bootstrap defaults
        // from appsettings.json under the "Topology" section.
        var topologyOptions = builder.Configuration.GetSection(TopologyOptions.SectionName)
            .Get<TopologyOptions>() ?? new TopologyOptions();
        builder.Services.AddSingleton(topologyOptions);
        builder.Services.AddSingleton<TopologyConfigStore>();
        builder.Services.AddSingleton<TopologyBuilder>(sp => new TopologyBuilder(
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<TopologyBuilder>()));

        // PATCH /api/config/topology is auth-gated by the same X-Api-Key
        // middleware as POST /api/deployments (SAD §7).
        var apiKey = Environment.GetEnvironmentVariable("API_TOKEN")
            ?? builder.Configuration["API_TOKEN"]
            ?? string.Empty;
        builder.Services.AddSingleton(new ApiKeyOptions { ApiKey = apiKey });

        // Real-time fan-out. The listener subscribes once per replica;
        // SlotUpdateBroker is a singleton because every connected SSE
        // client must see the same in-process stream.
        builder.Services.AddSingleton<SlotUpdateBroker>();
        builder.Services.AddSingleton<DeploymentListener>(sp => new DeploymentListener(
            connectionString,
            sp.GetRequiredService<SlotUpdateBroker>(),
            sp.GetRequiredService<IServiceScopeFactory>(),
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<DeploymentListener>()));
        builder.Services.AddHostedService(sp => sp.GetRequiredService<DeploymentListener>());

        builder.Services.Configure<JsonOptions>(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = DashboardJson.Options.PropertyNamingPolicy;
        });

        var app = builder.Build();

        DeploymentEndpoints.Map(app);
        DiscoveryEndpoints.Map(app);
        HealthEndpoint.Map(app);
        StreamEndpoint.Map(app);
        TopologyConfigEndpoint.Map(app);

        app.Run();
    }

    private static int ParseRetention(IConfiguration cfg)
    {
        var raw = Environment.GetEnvironmentVariable("HISTORY_RETENTION_DAYS")
            ?? cfg["HISTORY_RETENTION_DAYS"];
        return int.TryParse(raw, out var n) && n > 0 ? n : HistoryRetentionOptions.DefaultDays;
    }
}
