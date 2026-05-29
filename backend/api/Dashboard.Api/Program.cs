using System.Text.Json;
using System.Text.Json.Serialization;
using Dashboard.Api.Extensions;
using Dashboard.Read;
using Dashboard.Shared.Data;
using Dashboard.Write;
using Microsoft.EntityFrameworkCore;

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

var app = builder.Build();

// ── Migrations ────────────────────────────────────────────────────────────────
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<DashboardDbContext>();
    await db.Database.MigrateAsync();
}

app.UseExceptionHandler();

// ── Endpoints ─────────────────────────────────────────────────────────────────
app.MapWriteEndpoints();
app.MapReadEndpoints();

// Phase 5: SSE stream
// Phase 6: Fetcher state + ops

app.Run();

// Exposes Program to WebApplicationFactory in Dashboard.Api.Tests.
public partial class Program { }
