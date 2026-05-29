using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Api.Extensions;
using Dashboard.Read;
using Dashboard.Shared.Data;
using Dashboard.Write;
using Microsoft.EntityFrameworkCore;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// ── JSON ──────────────────────────────────────────────────────────────────────
// Global snake_case policy covers response DTOs (DeploymentEvent entity fields).
// Ingest DTO uses [JsonPropertyName] which takes precedence.
builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// ── Problem details ───────────────────────────────────────────────────────────
builder.Services.AddDashboardProblemDetails();

// ── Data ──────────────────────────────────────────────────────────────────────
builder.Services.AddDbContext<DashboardDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

// ── Write services ────────────────────────────────────────────────────────────
builder.Services.AddWriteServices();

// ── Read services ─────────────────────────────────────────────────────────────
builder.Services.AddReadServices();

// ── CORS (D6) ─────────────────────────────────────────────────────────────────
// Enabled only when CORS_ALLOWED_ORIGINS is set; empty/absent = off (gateway / same-origin).
var corsOrigins = builder.Configuration["CORS_ALLOWED_ORIGINS"];
if (!string.IsNullOrWhiteSpace(corsOrigins))
{
    var origins = corsOrigins.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    builder.Services.AddCors(opts =>
        opts.AddDefaultPolicy(policy =>
            policy.WithOrigins(origins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .DisallowCredentials()));
}

// ── OpenAPI ───────────────────────────────────────────────────────────────────
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((doc, _, _) =>
    {
        doc.Info.Title = "Deployment Dashboard API";
        doc.Info.Version = "v1";
        doc.Info.Description = "Write and read deployment events.";
        return Task.CompletedTask;
    });
});

var app = builder.Build();

// ── Migrations ────────────────────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
    await db.Database.MigrateAsync();
}

app.UseExceptionHandler();

if (!string.IsNullOrWhiteSpace(corsOrigins))
    app.UseCors();

// ── OpenAPI / Scalar ──────────────────────────────────────────────────────────
app.MapOpenApi();
app.MapScalarApiReference();

// ── Endpoints ─────────────────────────────────────────────────────────────────

// Liveness probe: process is up. Returns {"status":"ok"} per the OpenAPI contract.
app.MapGet("/healthz", () => Results.Ok(new { status = "ok" }))
   .WithTags("ops")
   .WithSummary("Liveness probe");

// Readiness probe: DB reachable + LISTEN attached.
// Returns 200 ready/degraded or 503 when the DB is not reachable.
app.MapGet("/readyz", async (DashboardDbContext db, IReadinessIndicator readiness, CancellationToken ct) =>
{
    var dbOk = false;
    try
    {
        await db.Database.ExecuteSqlRawAsync("SELECT 1", ct);
        dbOk = true;
    }
    catch { /* db unreachable */ }

    var listenOk = readiness.IsListenerConnected;
    var checks = new Dictionary<string, string>
    {
        ["db"] = dbOk ? "ok" : "fail",
        ["listen"] = listenOk ? "ok" : "fail",
    };

    if (!dbOk)
        return Results.Problem(
            title: "Service is not ready.",
            detail: "Database is not reachable.",
            statusCode: StatusCodes.Status503ServiceUnavailable,
            extensions: new Dictionary<string, object?> { ["checks"] = checks });

    var status = listenOk ? "ready" : "degraded";
    return Results.Ok(new { status, checks });
})
   .WithTags("ops")
   .WithSummary("Readiness probe");

app.MapWriteEndpoints();
app.MapFetcherStateEndpoints();
app.MapReadEndpoints();

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
