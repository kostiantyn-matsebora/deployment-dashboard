using Dashboard.ReadApi;
using Dashboard.Shared.Json;
using Dashboard.Shared.Persistence;
using Dashboard.Shared.Security;
using Dashboard.WriteApi;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;

namespace Dashboard.Api;

/// <summary>
/// Composition root for the unified API container (SAD §7 "Backend module
/// architecture" + §10 Decision 11). Composes two surface libraries —
/// <see cref="Dashboard.WriteApi"/> and <see cref="Dashboard.ReadApi"/> —
/// against a single <see cref="DashboardDbContext"/> and a single ASP.NET
/// Core host. The route map mirrors the SAD's auth boundary:
///
/// <list type="bullet">
///   <item>The Write group has <see cref="RouteHandlerBuilderExtensions.RequireApiKey"/>
///   applied — only <c>POST /api/deployments</c> and
///   <c>PATCH /api/config/topology</c> live there (§8).</item>
///   <item>Everything else (matrix / history / discovery / SSE / health /
///   <c>GET /api/config/topology</c>) is on the Read group, which has
///   no filter (FR-10 + Decision §10 #1).</item>
/// </list>
///
/// <para>Stateless: every request hits the DB; the SSE listener runs on a
/// dedicated Npgsql connection separate from the EF Core pool (NFR-05).</para>
///
/// <para>JSON only — no <c>UseStaticFiles</c>, no SPA fallback, no
/// <c>wwwroot</c>. The Angular SPA ships in its own nginx container
/// behind the App Gateway (SAD §7).</para>
/// </summary>
public sealed class Program
{
    public static void Main(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // ---- Shared host concerns -----------------------------------------
        // EF Core is shared by both surfaces — one connection pool, one
        // migration assembly. Lives in the host so neither library owns it.
        var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:DefaultConnection (env ConnectionStrings__DefaultConnection) is required.");

        builder.Services.AddDbContext<DashboardDbContext>(opt =>
            opt.UseNpgsql(connectionString, npg =>
                npg.MigrationsAssembly(typeof(DashboardDbContext).Assembly.FullName)));

        // snake_case on the wire by default; per-DTO [JsonPropertyName]
        // attributes still win for keys that must stay camelCase
        // (lastSuccessful, previousFailed). SAD §7 API Contract.
        builder.Services.Configure<JsonOptions>(o =>
        {
            o.SerializerOptions.PropertyNamingPolicy = DashboardJson.Options.PropertyNamingPolicy;
        });

        // ---- Surface-library DI -------------------------------------------
        builder.Services.AddWriteApi(builder.Configuration);
        builder.Services.AddReadApi(builder.Configuration);

        var app = builder.Build();

        // ---- Endpoint groups ----------------------------------------------
        // SAD §8 + WBS 1.1.4: the API-key filter is applied to the Write
        // endpoint group only — there is no global UseMiddleware call. The
        // Read group is unauthenticated by design.
        var write = app.MapGroup(string.Empty).RequireApiKey();
        write.MapWriteEndpoints();

        var read = app.MapGroup(string.Empty);
        read.MapReadEndpoints();

        app.Run();
    }
}
